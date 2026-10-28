# Storage layout action

Tracks the storage layout of contracts in a [Foundry](https://getfoundry.sh)
project and blocks changes that would corrupt storage when the contracts are
deployed behind upgradeable proxies or beacons.

Storage layout snapshots are committed to the repository (by default under
`storage-layouts/`), one JSON file per contract, generated with plain
`forge inspect`. On every run the action performs two checks per contract:

1. **Snapshot freshness** — the committed snapshot must match the storage
   layout of the current code, so the snapshot in the repository is always an
   up-to-date, reviewable record of the layout. Comparison is structural:
   `astId` noise and other irrelevant fields are normalized away.
2. **Upgrade compatibility** — the snapshot taken from the base of the change
   (pull request base branch, previous push tip, or the `base` input) must be
   upgrade-compatible with the current layout, using the same rules as the
   OpenZeppelin Upgrades plugins (via `@openzeppelin/upgrades-core`): existing
   variables keep their slot, offset and type; new variables are only appended
   or consume a `__gap`; gaps shrink exactly as much as the variables inserted
   alongside them.

## Usage

```yaml
name: Storage layout

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: 0xmichalis/storage-layout-action@v0
```

Releases are cut automatically when the version in `package.json` changes on
`main`; the matching `vX.Y.Z` tag is created and the floating major tag (`v0`)
moves to it. Pin a full release tag or commit SHA for stronger supply-chain
guarantees.

Foundry is installed automatically when `forge` is not already on the PATH
(set `foundry-version` to pin the version it installs). A shallow checkout is
fine: the action fetches the base ref itself.

### Bootstrapping

Generate and commit a snapshot for every contract you want checked:

```sh
mkdir -p storage-layouts
forge inspect MyVault storage-layout --json > storage-layouts/MyVault.json
```

Every contract with a snapshot in `storage-layouts/` at the base or in the current tree is checked
automatically — adding a contract to the check means adding its snapshot.
The `contracts` input is only needed to bootstrap from CI error messages or
to disambiguate contracts that share a name across files (fully qualified
names, e.g. `src/vaults/MyVault.sol:MyVault`).

### Requiring snapshots for new upgradeable contracts

By default a contract without a snapshot is not checked, so a new upgradeable
contract is unprotected until someone remembers to add its snapshot. List the
base contracts of your upgradeable contracts in `require-snapshots` to fail
instead:

```yaml
      - uses: 0xmichalis/storage-layout-action@v0
        with:
          require-snapshots: inherits:Initializable
          exempt-contracts: MyCloneTemplate
```

The action then builds the project and requires a snapshot for every deployable
contract under the Foundry `src` directory that inherits a rule's contract,
directly or through any number of base contracts. `inherits:Initializable`
covers OpenZeppelin (any version, upgradeable or not) and Solady, which all
name the contract `Initializable`. Add a rule per other base, such as
`inherits:UUPSUpgradeable` or your own upgradeable base.

A bare name matches any base contract with that name. A fully qualified name
only matches that one, e.g. to tell OpenZeppelin's upgradeable and
non-upgradeable `Initializable` apart:

```yaml
          require-snapshots: |
            inherits:lib/openzeppelin-contracts-upgradeable/contracts/proxy/utils/Initializable.sol:Initializable
            inherits:MyUpgradeableBase
```

A contract does not inherit itself. Abstract contracts, interfaces and contracts
outside `src` (tests, scripts, dependencies) are never required. Contracts come
from the forge build cache, so artifacts that forge leaves behind after a rename
or deletion are ignored.

The inheritance comes from the AST, so the action builds with `--ast`. Base
contracts are resolved by name through each file's imports (named, aliased,
wholesale and `as` imports) and cross-checked against solc's linearization. A
contract whose bases cannot all be resolved is required too, so the check fails
closed. When forge reuses an artifact built without the AST, for example after a
plain `forge build` in the same checkout, the action rebuilds once with
`--force`.

List contracts that are never upgraded in place, such as implementations only
used behind immutable clones, in `exempt-contracts`. A bare name exempts every
contract with that name, a fully qualified name only that one. An exempt
contract that has a snapshot is still checked.

### Changing storage intentionally

When a change to the layout is intended (appending a variable, consuming a
gap), regenerate the snapshot in the same pull request:

```sh
forge inspect MyVault storage-layout --json > storage-layouts/MyVault.json
```

The freshness check fails until the snapshot is regenerated, and the
compatibility check fails if the new layout is not upgrade-safe relative to
the base branch — so an unsafe change cannot be merged by regenerating the
snapshot.

Deleting or renaming a base snapshot also fails the check. To retire a contract,
delete its snapshot and list its bare name in `removed-contracts`. This deliberately
skips its compatibility check and records the removal in the summary. A removal
whose snapshot still exists is an error; a name without a base snapshot is ignored
with a notice. Review changes to this input as carefully as the storage layouts.
Without a compatibility base, only the current snapshots and `contracts` input
are checked and `removed-contracts` has no effect.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `contracts` | `''` | Comma- or newline-separated contracts to check in addition to the ones discovered from snapshots. Bare names (`Vault`) or fully qualified names (`src/Vault.sol:Vault`). |
| `removed-contracts` | `''` | Comma- or newline-separated bare names deliberately retired from the base. Their current snapshots must be absent. |
| `require-snapshots` | `''` | Comma- or newline-separated `inherits:<Contract>` rules: every deployable contract under `src` that inherits one of these contracts must have a snapshot. Empty checks only contracts with snapshots or listed in `contracts`. |
| `exempt-contracts` | `''` | Comma- or newline-separated contracts `require-snapshots` does not require. Bare names exempt every contract with that name; fully qualified names only that one. |
| `storage-layout-path` | `storage-layouts` | Directory holding the committed snapshots, relative to `working-directory`. |
| `working-directory` | `.` | Root of the Foundry project, relative to the repository checkout. |
| `base` | `''` | Git ref or commit providing the reference snapshots for the compatibility check. Overrides the automatic choice. |
| `unsafe-allow-renames` | `false` | Allow renaming state variables that keep their slot, offset and type. |
| `foundry-version` | `stable` | Foundry version to install when `forge` is not already on PATH. |

## How the compatibility base is picked

| Event | Base |
| --- | --- |
| `pull_request` / `pull_request_target` | Tip of the base branch, fetched from `origin` |
| `push` | The commit before the push (`event.before`) |
| `merge_group` | The merge queue base |
| anything else | Compatibility is skipped unless `base` is set |

The freshness check always runs. When a contract has no snapshot at the base
(a new contract), the compatibility check is skipped for it.

## Notes and limitations

- The check runs on solc's `storageLayout` output, which covers plain
  (inherited) storage. It does not model ERC-7201 namespaced storage, and
  NatSpec annotations such as `@custom:oz-renamed-from` are not honored (use
  `unsafe-allow-renames` for deliberate renames).
- Enum member lists are not part of solc's layout output, so the comparison
  treats same-named enums as compatible: value reorders or removals that keep
  the enum's byte size are not caught. Growing an enum past a byte boundary is
  caught, since the layout around it shifts.
- Snapshots may be committed exactly as `forge inspect` emits them; the
  freshness comparison ignores `astId` churn from unrelated source changes,
  so snapshots only need regenerating when the layout actually changes.
- `require-snapshots` only finds contracts that inherit a listed contract.
  Upgradeable contracts with no common base still need their snapshot added by
  hand. It also needs the forge build cache, which is on by default
  (`cache = true`), and the `--ast` build makes artifacts larger.
- The runner needs Node.js 20+ on PATH (GitHub-hosted runners have it).

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
      - uses: 0xmichalis/storage-layout-action@main
```

Foundry is installed automatically when `forge` is not already on the PATH
(set `foundry-version` to pin the version it installs). A shallow checkout is
fine: the action fetches the base ref itself.

### Bootstrapping

Generate and commit a snapshot for every contract you want checked:

```sh
mkdir -p storage-layouts
forge inspect MyVault storage-layout --json > storage-layouts/MyVault.json
```

Every contract with a snapshot in `storage-layouts/` is checked
automatically — adding a contract to the check means adding its snapshot.
The `contracts` input is only needed to bootstrap from CI error messages or
to disambiguate contracts that share a name across files (fully qualified
names, e.g. `src/vaults/MyVault.sol:MyVault`).

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

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `contracts` | `''` | Comma- or newline-separated contracts to check in addition to the ones discovered from snapshots. Bare names (`Vault`) or fully qualified names (`src/Vault.sol:Vault`). |
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
- Enum member lists are not part of solc's layout output, so enum reorders
  that keep the enum's byte size are not caught. Growing an enum past a byte
  boundary is caught.
- Snapshots may be committed exactly as `forge inspect` emits them; the
  freshness comparison ignores `astId` churn from unrelated source changes,
  so snapshots only need regenerating when the layout actually changes.
- The runner needs Node.js 20+ on PATH (GitHub-hosted runners have it).

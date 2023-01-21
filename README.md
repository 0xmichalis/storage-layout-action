# Solidity storage layout action

This action checks for storage layout conflicts in upgradeable Solidity contracts.

## Inputs

### `buildArtifactsPath`

**Required** Path to the directory where the Solidity compiler outputs built contracts. Defaults to `artifacts`.

### `storageLayoutPath`

**Required** Path to the directory where contract storage layout is cached. Defaults to `.openzeppelin`.

### `fullyQualifiedContractNames`

**Required** Comma-separated list of fully qualified contract names to inspect their storage layout for conflicts. Must match with `proxyOrBeaconAddresses`.

### `proxyOrBeaconAddresses`

**Required** Comma-separated list of proxy or beacon addresses to inspect for conflicts. Must match with `fullyQualifiedContractNames`.

### `nodeRpcUrl`

**Required** RPC URL to a blockchain node.


## Example usage

```yaml
uses: actions/storage-layout-action@v0.1
with:
  fullyQualifiedContractNames: RetirementCertificates,ToucanCarbonOffsets
  proxyOrBeaconAddresses: 0x5e377f16E4ec6001652befD737341a28889Af002,0xD46eE8815F141749834AF0Df21E744459eFEc75F
  nodeRpcUrl: https://matic-mainnet.chainstacklabs.com
```

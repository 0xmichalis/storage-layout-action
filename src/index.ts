import * as core from '@actions/core'
import {
  UpgradeableContract,
  getStorageUpgradeReport,
  StorageUpgradeErrors,
  Manifest,
  withValidationDefaults,
  getBeaconAddress,
  getImplementationAddressFromBeacon,
  getImplementationAddress,
  EthereumProvider
} from '@openzeppelin/upgrades-core'
import {providers} from 'ethers'

import {getBuildInfo} from './utils'

async function getImplementationForProxyOrBeacon(
  provider: EthereumProvider,
  proxyOrBeaconAddress: string
): Promise<string> {
  // Check if it's a UUPS or Transparent proxy
  try {
    const implAddress = await getImplementationAddress(provider, proxyOrBeaconAddress)
    return implAddress
  } catch {}

  // Check if it's a beacon proxy
  try {
    const implAddress = await getBeaconAddress(provider, proxyOrBeaconAddress)
    return implAddress
  } catch {}

  // Check if it's a beacon
  try {
    const implAddress = await getImplementationAddressFromBeacon(provider, proxyOrBeaconAddress)
    return implAddress
  } catch {}

  throw Error(`Provided address does not look like a proxy or beacon: ${proxyOrBeaconAddress}`)
}

async function run(): Promise<void> {
  try {
    const contractNames = core.getInput('fullyQualifiedContractNames').split(',')
    const addresses = core.getInput('proxyOrBeaconAddresses').split(',')
    if (contractNames.length !== addresses.length)
      throw Error(
        `Length mismatch between fullyQualifiedContractNames (${contractNames.length}) and proxyOrBeaconAddresses (${addresses.length})`
      )

    const storageLayoutPath = core.getInput('storageLayoutPath')
    if (storageLayoutPath !== '.openzeppelin') {
      // TODO: Copy to .openzeppelin
    }

    const rpcURL = core.getInput('nodeRpcUrl')
    const provider = new providers.StaticJsonRpcProvider(rpcURL)
    const manifest = await Manifest.forNetwork(provider)

    const artifactsPath = core.getInput('buildArtifactsPath')
    for (let i = 0; i < contractNames.length; i++) {
      // Determine layout for deployed contract by looking at network manifest
      const implAddress = await getImplementationForProxyOrBeacon(provider, addresses[i])
      const d = await manifest.getDeploymentFromAddress(implAddress)

      // Generate storage upgrade report
      const solcInfo = await getBuildInfo(artifactsPath, contractNames[i])
      const updated = new UpgradeableContract(contractNames[i], solcInfo.input, solcInfo.output)
      const report = getStorageUpgradeReport(
        d.layout,
        updated.layout,
        withValidationDefaults({
          unsafeAllowRenames: true
        })
      )

      // Check report results
      if (!report.pass) {
        throw new StorageUpgradeErrors(report)
      }
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()

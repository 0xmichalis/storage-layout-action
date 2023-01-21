import * as core from '@actions/core'
import {
  UpgradeableContract,
  getStorageUpgradeReport,
  StorageUpgradeErrors,
  withValidationDefaults
} from '@openzeppelin/upgrades-core'

import {getBuildInfo} from './utils'

async function run(): Promise<void> {
  try {
    const artifactsPath = core.getInput('buildArtifactsPath')
    const contractNames = core.getInput('fullyQualifiedContractNames').split(',')

    for await (const fqName of contractNames) {
      const solcInfo = await getBuildInfo(artifactsPath, fqName)
      const updated = new UpgradeableContract(fqName, solcInfo.input, solcInfo.output)

      // TODO: Determine original layout via reading .openzeppelin

      const report = getStorageUpgradeReport(
        original,
        updated.layout,
        withValidationDefaults({
          unsafeAllowRenames: true
        })
      )

      if (!report.pass) {
        throw new StorageUpgradeErrors(report)
      }
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()

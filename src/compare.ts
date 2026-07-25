import {getStorageUpgradeReport, withValidationDefaults} from '@openzeppelin/upgrades-core'

import {NormalizedLayout} from './types'

export interface CompatibilityResult {
  pass: boolean
  explanation: string
}

type UpgradesLayout = Parameters<typeof getStorageUpgradeReport>[0]

/**
 * The report prefixes findings with each item's `src` (set by the OZ plugins
 * from AST data). Solc layouts have no `src`, so reuse the declaring
 * contract for readable messages.
 */
function toUpgradesLayout(layout: NormalizedLayout): UpgradesLayout {
  return {
    storage: layout.storage.map(item =>
      item.contract === undefined ? item : {...item, src: item.contract}
    ),
    types: layout.types
  } as unknown as UpgradesLayout
}

/**
 * Checks that `newLayout` is a storage-compatible upgrade of `oldLayout`,
 * using the same rules as the OpenZeppelin Upgrades plugins (append-only,
 * storage gap consumption, no type or slot changes).
 */
export function checkCompatibility(
  oldLayout: NormalizedLayout,
  newLayout: NormalizedLayout,
  unsafeAllowRenames: boolean
): CompatibilityResult {
  try {
    // solc layouts carry no enum member lists, so without
    // unsafeAllowCustomTypes every enum-bearing layout is rejected as
    // "insufficient data to compare enums" even when identical. The flag
    // only suppresses that insufficient-data path; struct members are
    // present in solc output and remain fully enforced.
    const report = getStorageUpgradeReport(
      toUpgradesLayout(oldLayout),
      toUpgradesLayout(newLayout),
      withValidationDefaults({unsafeAllowRenames, unsafeAllowCustomTypes: true})
    )
    return {
      pass: report.pass,
      explanation: report.pass ? '' : report.explain().replace(/^undefined: /gm, '')
    }
  } catch (error) {
    return {
      pass: false,
      explanation: `storage layout comparison failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    }
  }
}

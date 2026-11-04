import {getStorageUpgradeReport, withValidationDefaults} from '@openzeppelin/upgrades-core'

import {NormalizedLayout, NormalizedSection} from './types'

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
function toUpgradesLayout(section: NormalizedSection): UpgradesLayout {
  return {
    storage: section.storage.map(item =>
      item.contract === undefined ? item : {...item, src: item.contract}
    ),
    types: section.types
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
  const failures: string[] = []
  const plain = compareSection(oldLayout, newLayout, unsafeAllowRenames)
  if (!plain.pass) failures.push(plain.explanation)
  // Each ERC-7201 namespace is compared on its own types. A namespace missing
  // from the base is new; one missing from the update is deleted.
  for (const [location, before] of Object.entries(oldLayout.namespaces ?? {})) {
    const after = newLayout.namespaces?.[location]
    if (after === undefined) {
      if (before.storage.length > 0) failures.push(`Deleted namespace \`${location}\``)
      continue
    }
    const result = compareSection(before, after, unsafeAllowRenames)
    if (!result.pass) failures.push(`${location}:\n${result.explanation}`)
  }
  return {pass: failures.length === 0, explanation: failures.join('\n')}
}

function compareSection(
  oldLayout: NormalizedSection,
  newLayout: NormalizedSection,
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

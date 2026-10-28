import * as fs from 'fs'
import * as path from 'path'

import {DiscoveredContract, RequireRule} from './discover'

export interface ContractSpec {
  /** Bare contract name; also the snapshot file basename. */
  name: string
  /** Identifier passed to `forge inspect`: bare name or fully qualified name. */
  target: string
  /** Why a snapshot is required, for contracts found by `require-snapshots`. */
  reason?: string
}

const CONTRACT_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function splitEntries(input: string): string[] {
  return input
    .split(/[\n,]/)
    .map(entry => entry.trim())
    .filter(entry => entry !== '')
}

function parseEntry(entry: string): ContractSpec {
  if (entry.startsWith('-')) {
    throw new Error(`invalid contract entry '${entry}'`)
  }
  const name = entry.includes(':') ? entry.slice(entry.lastIndexOf(':') + 1) : entry
  if (!CONTRACT_NAME.test(name)) {
    throw new Error(
      `invalid contract entry '${entry}': expected a contract name or fully qualified name (path/to/File.sol:Name)`
    )
  }
  return {name, target: entry}
}

/** Parses a bare or fully qualified name, normalizing the source path. */
function parseQualified(entry: string): ContractSpec & {source?: string} {
  const spec = parseEntry(entry)
  if (spec.target === spec.name) return spec
  const source = path.posix.normalize(spec.target.slice(0, spec.target.lastIndexOf(':')))
  return {name: spec.name, target: `${source}:${spec.name}`, source}
}

/**
 * Parses the `require-snapshots` input: `inherits:<Contract>` rules with a
 * bare or fully qualified base contract name.
 */
export function parseRequireRules(input: string): RequireRule[] {
  const rules = new Map<string, RequireRule>()
  for (const entry of splitEntries(input)) {
    let base: ContractSpec & {source?: string}
    try {
      if (!entry.startsWith('inherits:')) throw new Error()
      base = parseQualified(entry.slice('inherits:'.length))
    } catch {
      throw new Error(
        `invalid \`require-snapshots\` rule '${entry}': expected \`inherits:<Contract>\`, where <Contract> is a contract name or fully qualified name (path/to/File.sol:Name)`
      )
    }
    const label = `inherits:${base.target}`
    rules.set(label, {label, name: base.name, source: base.source})
  }
  return [...rules.values()]
}

const EXEMPT_HINT = 'If it is never upgraded in place, list it in `exempt-contracts` instead.'

function requiredReason(contract: DiscoveredContract): string {
  if (contract.rules.length > 0) {
    const rules = contract.rules.map(rule => `\`${rule}\``).join(', ')
    return `\`require-snapshots\` requires it (${rules}). ${EXEMPT_HINT}`
  }
  return `\`require-snapshots\` requires it because not all of its base contracts could be resolved, so no rule can rule it out. ${EXEMPT_HINT}`
}

/**
 * Resolves the set of contracts to check: the union of the explicit
 * `contracts` input, the contracts discovered from current and base snapshot
 * files, and the `required` contracts found in the build. Required entries
 * replace snapshot-derived ones, since their fully qualified names are
 * unambiguous; explicit entries win over both.
 */
export function resolveContractSet(
  contractsInput: string,
  snapshotDir: string,
  baseNames: string[] = [],
  required: ContractSpec[] = []
): ContractSpec[] {
  const specs = new Map<string, ContractSpec>()
  for (const name of baseNames) {
    if (!CONTRACT_NAME.test(name)) throw new Error(`invalid base snapshot contract name '${name}'`)
    specs.set(name, {name, target: name})
  }

  if (fs.existsSync(snapshotDir)) {
    for (const file of fs.readdirSync(snapshotDir).sort()) {
      if (!file.endsWith('.json')) continue
      const name = path.basename(file, '.json')
      if (!CONTRACT_NAME.test(name)) {
        throw new Error(
          `snapshot file '${file}' does not map to a contract name; expected <ContractName>.json`
        )
      }
      specs.set(name, {name, target: name})
    }
  }

  for (const spec of required) specs.set(spec.name, spec)

  const explicit = new Set<string>()
  for (const entry of splitEntries(contractsInput)) {
    const spec = parseEntry(entry)
    if (explicit.has(spec.name)) {
      throw new Error(
        `duplicate contract name '${spec.name}' in \`contracts\` input; snapshot files are keyed by bare contract name`
      )
    }
    explicit.add(spec.name)
    specs.set(spec.name, spec)
  }

  return [...specs.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Turns the contracts found by `require-snapshots` into specs, minus the
 * `exempt-contracts` entries: a bare name exempts every contract with that
 * name, a fully qualified name only that one. Also returns the exemptions
 * that matched nothing.
 */
export function resolveRequiredContracts(
  found: DiscoveredContract[],
  exemptInput: string
): {required: ContractSpec[]; unmatched: string[]} {
  const exemptions = splitEntries(exemptInput).map(parseQualified)
  const matched = new Set<string>()
  const required = new Map<string, ContractSpec>()
  for (const contract of found) {
    const target = `${contract.source}:${contract.name}`
    const matching = exemptions.filter(
      spec => spec.target === contract.name || spec.target === target
    )
    if (matching.length > 0) {
      for (const spec of matching) matched.add(spec.target)
      continue
    }
    const existing = required.get(contract.name)
    if (existing !== undefined) {
      throw new Error(
        `'${existing.target}' and '${target}' share the name '${contract.name}', but snapshot files are keyed by bare contract name; exempt one of them by its fully qualified name in \`exempt-contracts\``
      )
    }
    required.set(contract.name, {name: contract.name, target, reason: requiredReason(contract)})
  }
  return {
    required: [...required.values()],
    unmatched: [...new Set(exemptions.map(spec => spec.target))].filter(
      target => !matched.has(target)
    )
  }
}

export function resolveRemovedContracts(
  input: string,
  snapshotDir: string,
  baseNames: string[]
): {removed: string[]; unknown: string[]} {
  const removed: string[] = []
  const unknown: string[] = []
  const names = new Set(splitEntries(input))
  for (const name of names) {
    if (!CONTRACT_NAME.test(name)) {
      throw new Error(`invalid removed contract '${name}': expected a bare contract name`)
    }
    if (fs.existsSync(path.join(snapshotDir, `${name}.json`))) {
      throw new Error(
        `removed contract '${name}' still has a snapshot; remove it or clear \`removed-contracts\``
      )
    }
    if (baseNames.includes(name)) removed.push(name)
    else unknown.push(name)
  }
  return {removed, unknown}
}

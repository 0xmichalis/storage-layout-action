import * as fs from 'fs'
import * as path from 'path'

export interface ContractSpec {
  /** Bare contract name; also the snapshot file basename. */
  name: string
  /** Identifier passed to `forge inspect`: bare name or fully qualified name. */
  target: string
}

const CONTRACT_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/

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

/**
 * Resolves the set of contracts to check: the union of the explicit
 * `contracts` input and the contracts discovered from existing snapshot
 * files. Explicit entries win so fully qualified names can disambiguate.
 */
export function resolveContractSet(contractsInput: string, snapshotDir: string): ContractSpec[] {
  const specs = new Map<string, ContractSpec>()

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

  const entries = contractsInput
    .split(/[\n,]/)
    .map(entry => entry.trim())
    .filter(entry => entry !== '')
  const explicit = new Set<string>()
  for (const entry of entries) {
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

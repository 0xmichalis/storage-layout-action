import * as fs from 'fs'
import * as path from 'path'

import {ForgeConfig} from './forge'

/** One `inherits:<Contract>` rule of the `require-snapshots` input. */
export interface RequireRule {
  /** The rule as normalized, for messages. */
  label: string
  /** Bare name of the base contract. */
  name: string
  /** Source of the base contract, when the rule names it fully qualified. */
  source?: string
}

/** A deployable contract under `src` that a `require-snapshots` rule selects. */
export interface DiscoveredContract {
  /** Bare contract name. */
  name: string
  /** Source file relative to the project root, with POSIX separators. */
  source: string
  /** Labels of the rules it matches. */
  rules: string[]
  /**
   * Set when its base contracts could not all be resolved, so no rule can
   * rule it out.
   */
  unresolved?: boolean
}

/** An artifact needed for inheritance has no AST; a forced rebuild fixes it. */
export class MissingAstError extends Error {}

const CACHE_FILE = 'solidity-files-cache.json'

interface ContractNode {
  nodeType: 'ContractDefinition'
  name: string
  baseContracts?: {baseName?: {name?: unknown}}[]
  linearizedBaseContracts?: unknown[]
}

interface ImportNode {
  nodeType: 'ImportDirective'
  absolutePath?: unknown
  unitAlias?: unknown
  symbolAliases?: {foreign?: {name?: unknown}; local?: unknown}[]
}

interface SourceUnit {
  nodes?: {nodeType?: unknown}[]
}

interface CacheEntry {
  artifacts?: unknown
  imports?: unknown
}

/** Abstract contracts and interfaces have no bytecode. */
function isDeployable(artifact: unknown): boolean {
  if (typeof artifact !== 'object' || artifact === null) return false
  const object = (artifact as {bytecode?: {object?: unknown}}).bytecode?.object
  return typeof object === 'string' && object !== '' && object !== '0x'
}

/**
 * Artifact paths recorded for one contract in the forge build cache. The
 * nesting under the contract name (compiler version, compiler profile) has
 * changed across forge releases, so every `.json` string leaf counts.
 */
export function artifactPaths(entry: unknown): string[] {
  if (typeof entry === 'string') return entry.endsWith('.json') ? [entry] : []
  if (typeof entry !== 'object' || entry === null) return []
  return Object.values(entry).flatMap(artifactPaths)
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`could not read '${file}': ${error instanceof Error ? error.message : error}`)
  }
}

/**
 * Sources and artifacts of the last build, keyed by source path relative to
 * the project root. AST node ids are only consistent within one compiler
 * run, and incremental builds mix runs, so inheritance is resolved by name
 * the way solc resolves it, never by id across files.
 */
class BuildIndex {
  private readonly entries = new Map<string, CacheEntry>()
  private readonly units = new Map<string, SourceUnit | null>()
  private readonly artifacts = new Map<string, unknown>()

  constructor(
    private readonly projectRoot: string,
    private readonly outDir: string,
    files: Record<string, unknown>
  ) {
    for (const [file, entry] of Object.entries(files)) {
      if (typeof entry === 'object' && entry !== null) {
        this.entries.set(this.key(file), entry as CacheEntry)
      }
    }
  }

  key(file: string): string {
    return path
      .relative(this.projectRoot, path.resolve(this.projectRoot, file))
      .split(path.sep)
      .join('/')
  }

  sources(): string[] {
    return [...this.entries.keys()]
  }

  contracts(source: string): string[] {
    const artifacts = this.entries.get(source)?.artifacts
    return typeof artifacts === 'object' && artifacts !== null ? Object.keys(artifacts) : []
  }

  imports(source: string): string[] {
    const imports = this.entries.get(source)?.imports
    return Array.isArray(imports)
      ? imports
          .filter((entry): entry is string => typeof entry === 'string')
          .map(entry => this.key(entry))
      : []
  }

  /** The first existing artifact of a contract; throws when there is none. */
  artifact(source: string, name: string): unknown {
    const id = `${source}:${name}`
    if (!this.artifacts.has(id)) {
      const artifacts = this.entries.get(source)?.artifacts as Record<string, unknown> | undefined
      const file = artifactPaths(artifacts?.[name])
        .map(artifact => path.resolve(this.outDir, artifact))
        .find(artifact => fs.existsSync(artifact))
      if (file === undefined) {
        throw new Error(
          `the forge build cache lists ${id}, but none of its artifacts exist in '${this.outDir}'; rebuild the project`
        )
      }
      this.artifacts.set(id, readJson(file))
    }
    return this.artifacts.get(id)
  }

  /**
   * The AST of a source, from any of its artifacts. `null` for a source
   * without contracts, which forge writes no artifact for.
   */
  unit(source: string): SourceUnit | null {
    if (!this.units.has(source)) {
      const [name] = this.contracts(source)
      let unit: SourceUnit | null = null
      if (name !== undefined) {
        const ast = (this.artifact(source, name) as {ast?: unknown}).ast
        if (typeof ast !== 'object' || ast === null) {
          throw new MissingAstError(`the artifact of ${source}:${name} has no AST`)
        }
        unit = ast as SourceUnit
      }
      this.units.set(source, unit)
    }
    return this.units.get(source) ?? null
  }
}

function nodesOf<T>(unit: SourceUnit, nodeType: string): T[] {
  return (unit.nodes ?? []).filter(node => node.nodeType === nodeType) as T[]
}

/**
 * Finds the contract a (possibly qualified) symbol names in the scope of a
 * source: its own contracts, then what it imports by name, by unit alias or
 * wholesale.
 */
function lookup(
  index: BuildIndex,
  source: string,
  symbol: string,
  seen = new Set<string>()
): {source: string; node: ContractNode} | undefined {
  const visit = `${source}\0${symbol}`
  if (seen.has(visit)) return undefined
  seen.add(visit)

  const [head, ...rest] = symbol.split('.')
  const unit = index.unit(source)
  if (unit === null) {
    if (rest.length > 0) return undefined
    for (const imported of index.imports(source)) {
      const found = lookup(index, imported, symbol, seen)
      if (found !== undefined) return found
    }
    return undefined
  }

  if (rest.length === 0) {
    const own = nodesOf<ContractNode>(unit, 'ContractDefinition').find(node => node.name === head)
    if (own !== undefined) return {source, node: own}
  }
  for (const directive of nodesOf<ImportNode>(unit, 'ImportDirective')) {
    if (typeof directive.absolutePath !== 'string') continue
    const target = index.key(directive.absolutePath)
    const aliases = directive.symbolAliases ?? []
    let found: {source: string; node: ContractNode} | undefined
    if (aliases.length > 0) {
      const alias = aliases.find(entry => (entry.local ?? entry.foreign?.name) === head)
      if (typeof alias?.foreign?.name === 'string') {
        found = lookup(index, target, [alias.foreign.name, ...rest].join('.'), seen)
      }
    } else if (typeof directive.unitAlias === 'string' && directive.unitAlias !== '') {
      if (directive.unitAlias === head && rest.length > 0) {
        found = lookup(index, target, rest.join('.'), seen)
      }
    } else {
      found = lookup(index, target, symbol, seen)
    }
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * All base contracts of a contract as `source:name`, or `undefined` when one
 * of them cannot be resolved or the result disagrees with solc's
 * linearization.
 */
function baseContracts(index: BuildIndex, source: string, name: string): Set<string> | undefined {
  const unit = index.unit(source)
  const node = unit && nodesOf<ContractNode>(unit, 'ContractDefinition').find(n => n.name === name)
  if (!node) return undefined

  const bases = new Set<string>()
  const walk = (from: string, contract: ContractNode): boolean => {
    for (const base of contract.baseContracts ?? []) {
      const symbol = base.baseName?.name
      if (typeof symbol !== 'string') return false
      const found = lookup(index, from, symbol)
      if (found === undefined) return false
      const id = `${found.source}:${found.node.name}`
      if (bases.has(id)) continue
      bases.add(id)
      if (!walk(found.source, found.node)) return false
    }
    return true
  }
  if (!walk(source, node)) return undefined

  const linearized = new Set(node.linearizedBaseContracts ?? [])
  return linearized.size === bases.size + 1 ? bases : undefined
}

function matches(bases: Set<string>, rule: RequireRule): boolean {
  if (rule.source !== undefined) return bases.has(`${rule.source}:${rule.name}`)
  return [...bases].some(base => base.slice(base.lastIndexOf(':') + 1) === rule.name)
}

/**
 * Lists the deployable contracts under `config.src` that inherit a rule's
 * contract, directly or through any number of bases. Requires a completed
 * `forge build --ast`.
 * Contracts come from the build cache rather than a scan of `out`, because
 * forge leaves the artifacts of renamed and deleted contracts behind.
 */
export function findRequiredContracts(
  projectRoot: string,
  config: ForgeConfig,
  rules: RequireRule[]
): DiscoveredContract[] {
  if (!config.cache) {
    throw new Error(
      '`require-snapshots` needs the forge build cache; enable `cache` in foundry.toml'
    )
  }
  const cacheFile = path.resolve(projectRoot, config.cachePath, CACHE_FILE)
  if (!fs.existsSync(cacheFile)) {
    throw new Error(`no forge build cache at '${cacheFile}'`)
  }
  const cache = readJson(cacheFile) as {files?: unknown}
  if (typeof cache.files !== 'object' || cache.files === null) {
    throw new Error(`unexpected forge build cache format in '${cacheFile}'`)
  }

  const index = new BuildIndex(
    projectRoot,
    path.resolve(projectRoot, config.out),
    cache.files as Record<string, unknown>
  )
  const srcDir = path.resolve(projectRoot, config.src)
  const found: DiscoveredContract[] = []
  for (const source of index.sources()) {
    const fromSrc = path.relative(srcDir, path.resolve(projectRoot, source))
    if (
      fromSrc === '' ||
      fromSrc === '..' ||
      fromSrc.startsWith(`..${path.sep}`) ||
      path.isAbsolute(fromSrc)
    ) {
      continue
    }

    for (const name of index.contracts(source)) {
      if (!isDeployable(index.artifact(source, name))) continue

      const bases = baseContracts(index, source, name)
      if (bases === undefined) {
        found.push({name, source, rules: [], unresolved: true})
        continue
      }
      const matched = rules.filter(rule => matches(bases, rule)).map(rule => rule.label)
      if (matched.length > 0) found.push({name, source, rules: matched})
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source))
}

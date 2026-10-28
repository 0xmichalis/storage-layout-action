import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {parseRequireRules} from '../src/contracts'
import {artifactPaths, findRequiredContracts, MissingAstError} from '../src/discover'
import {ForgeConfig} from '../src/forge'

describe('artifactPaths', () => {
  it('reads current and older cache layouts', () => {
    expect(
      artifactPaths({'0.8.30': {default: {path: 'Vault.sol/Vault.json', build_id: 'abc'}}})
    ).toEqual(['Vault.sol/Vault.json'])
    expect(artifactPaths({'0.8.19': 'Vault.sol/Vault.json'})).toEqual(['Vault.sol/Vault.json'])
    expect(
      artifactPaths({
        '0.8.26': {default: {path: 'A.sol/A.json'}, 'via-ir': {path: 'A.sol/A.via-ir.json'}}
      })
    ).toEqual(['A.sol/A.json', 'A.sol/A.via-ir.json'])
  })
})

interface FakeContract {
  name: string
  /** Abstract contracts and interfaces have no bytecode. */
  abstract?: boolean
  /** Direct bases as written in the source. */
  bases?: string[]
  /** Length of solc's linearizedBaseContracts, itself included. */
  linearized?: number
}

const contractNode = ({name, bases = [], linearized}: FakeContract) => ({
  nodeType: 'ContractDefinition',
  name,
  baseContracts: bases.map(base => ({baseName: {name: base}})),
  linearizedBaseContracts: Array.from({length: linearized ?? bases.length + 1}, (_, i) => i)
})

const importNode = (
  absolutePath: string,
  options: {aliases?: [string, string?][]; unitAlias?: string} = {}
) => ({
  nodeType: 'ImportDirective',
  absolutePath,
  unitAlias: options.unitAlias ?? '',
  symbolAliases: (options.aliases ?? []).map(([foreign, local]) => ({
    foreign: {name: foreign},
    local: local ?? null
  }))
})

const OZ = 'lib/oz/Initializable.sol'

describe('findRequiredContracts', () => {
  let root: string
  let cache: Record<string, unknown>
  const config: ForgeConfig = {src: 'src', out: 'out', cachePath: 'cache', cache: true}

  const writeArtifact = (relative: string, content: unknown) => {
    const file = path.join(root, 'out', relative)
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, JSON.stringify(content))
  }

  /** Writes a source's artifacts (with its AST unless `ast` is false) and cache entry. */
  const addSource = (
    source: string,
    contracts: FakeContract[],
    options: {imports?: ReturnType<typeof importNode>[]; ast?: boolean} = {}
  ) => {
    const imports = options.imports ?? []
    const ast = {
      nodeType: 'SourceUnit',
      absolutePath: source,
      nodes: [...imports, ...contracts.map(contractNode)]
    }
    const artifacts: Record<string, unknown> = {}
    for (const contract of contracts) {
      const relative = `${path.basename(source)}/${contract.name}.json`
      writeArtifact(relative, {
        abi: [],
        bytecode: {object: contract.abstract ? '0x' : '0x6080'},
        ...(options.ast === false ? {} : {ast})
      })
      artifacts[contract.name] = {'0.8.30': {default: {path: relative, build_id: 'abc'}}}
    }
    cache[source] = {artifacts, imports: imports.map(directive => directive.absolutePath)}
  }

  /** A contract in `source` that imports and inherits OZ's Initializable. */
  const addInitializable = (source: string, name: string, options: {ast?: boolean} = {}) =>
    addSource(source, [{name, bases: ['Initializable']}], {
      imports: [importNode(OZ, {aliases: [['Initializable']]})],
      ...options
    })

  /** Registers a source without contracts, which forge writes no artifact for. */
  const addFacade = (source: string, imports: string[]) => {
    cache[source] = {artifacts: {}, imports}
  }

  const run = (rules: string, options: Partial<ForgeConfig> = {}) => {
    fs.mkdirSync(path.join(root, 'cache'), {recursive: true})
    fs.writeFileSync(
      path.join(root, 'cache', 'solidity-files-cache.json'),
      JSON.stringify({_format: '', files: cache})
    )
    return findRequiredContracts(root, {...config, ...options}, parseRequireRules(rules))
  }

  const names = (rules: string) => run(rules).map(contract => contract.name)

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-'))
    cache = {}
    addSource(OZ, [{name: 'Initializable', abstract: true}])
  })

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true})
  })

  it('lists deployable contracts under src that inherit a rule contract', () => {
    addSource(
      'src/Module.sol',
      [
        {name: 'ModuleBase', abstract: true, bases: ['Initializable']},
        {name: 'Module', bases: ['ModuleBase'], linearized: 3}
      ],
      {imports: [importNode(OZ, {aliases: [['Initializable']]})]}
    )
    addSource('src/Plain.sol', [{name: 'Plain'}])
    addInitializable('test/Mock.t.sol', 'Mock')
    expect(run('inherits:Initializable')).toEqual([
      {name: 'Module', source: 'src/Module.sol', rules: ['inherits:Initializable']}
    ])
  })

  it('ignores stale artifacts the build cache no longer lists', () => {
    writeArtifact('Module.sol/Module.json', {abi: [], bytecode: {object: '0x6080'}})
    addInitializable('src/Module.sol', 'Renamed')
    expect(names('inherits:Initializable')).toEqual(['Renamed'])
  })

  it('keeps src entries whose names start with two dots', () => {
    addInitializable('src/..legacy/Module.sol', 'Module')
    addInitializable('../Outside.sol', 'Outside')
    expect(run('inherits:Initializable')).toEqual([
      {name: 'Module', source: 'src/..legacy/Module.sol', rules: ['inherits:Initializable']}
    ])
  })

  it('accepts absolute paths in the config and the cache', () => {
    addInitializable(path.join(root, 'src', 'Module.sol'), 'Module')
    expect(
      run('inherits:Initializable', {src: path.join(root, 'src'), out: path.join(root, 'out')})
    ).toEqual([{name: 'Module', source: 'src/Module.sol', rules: ['inherits:Initializable']}])
  })

  it('follows named, aliased, wholesale and unit-aliased imports', () => {
    addFacade('src/Facade.sol', [OZ])
    // import {Initializable as I} from "lib/oz/Initializable.sol"
    addSource('src/Aliased.sol', [{name: 'Aliased', bases: ['I']}], {
      imports: [importNode(OZ, {aliases: [['Initializable', 'I']]})]
    })
    // import "./Facade.sol", which only re-exports lib/oz/Initializable.sol
    addSource('src/ViaFacade.sol', [{name: 'ViaFacade', bases: ['Initializable']}], {
      imports: [importNode('src/Facade.sol')]
    })
    // import "lib/oz/Initializable.sol" as OZ
    addSource('src/Qualified.sol', [{name: 'Qualified', bases: ['OZ.Initializable']}], {
      imports: [importNode(OZ, {unitAlias: 'OZ'})]
    })
    addSource('src/Chain.sol', [{name: 'Chain', bases: ['Aliased'], linearized: 3}], {
      imports: [importNode('src/Aliased.sol', {aliases: [['Aliased']]})]
    })

    const expected = ['Aliased', 'Chain', 'Qualified', 'ViaFacade']
    expect(names('inherits:Initializable')).toEqual(expected)
    expect(names(`inherits:${OZ}:Initializable`)).toEqual(expected)
    expect(names('inherits:src/Other.sol:Initializable')).toEqual([])
    // A contract does not inherit itself.
    expect(run('inherits:Aliased')).toEqual([
      {name: 'Chain', source: 'src/Chain.sol', rules: ['inherits:Aliased']}
    ])
  })

  it('lists every rule a contract matches', () => {
    addSource('lib/oz/UUPS.sol', [{name: 'UUPSUpgradeable', abstract: true}])
    addSource('src/Both.sol', [{name: 'Both', bases: ['Initializable', 'UUPSUpgradeable']}], {
      imports: [importNode(OZ), importNode('lib/oz/UUPS.sol')]
    })
    expect(run('inherits:Initializable, inherits:UUPSUpgradeable')).toEqual([
      {
        name: 'Both',
        source: 'src/Both.sol',
        rules: ['inherits:Initializable', 'inherits:UUPSUpgradeable']
      }
    ])
  })

  it('marks contracts whose bases cannot all be resolved', () => {
    addSource('src/Broken.sol', [{name: 'Broken', bases: ['Missing']}], {
      imports: [importNode('src/Missing.sol')]
    })
    addSource('src/Mismatch.sol', [{name: 'Mismatch', bases: ['Initializable'], linearized: 3}], {
      imports: [importNode(OZ)]
    })
    expect(run('inherits:Nothing')).toEqual([
      {name: 'Broken', source: 'src/Broken.sol', rules: [], unresolved: true},
      {name: 'Mismatch', source: 'src/Mismatch.sol', rules: [], unresolved: true}
    ])
  })

  it('reports an artifact without an AST so the caller can rebuild', () => {
    addInitializable('src/Late.sol', 'Late', {ast: false})
    expect(() => run('inherits:Initializable')).toThrow(MissingAstError)
  })

  it('fails closed when a listed contract has no artifact', () => {
    cache['src/Module.sol'] = {
      artifacts: {Module: {'0.8.30': {default: {path: 'Module.sol/Module.json'}}}}
    }
    expect(() => run('inherits:Initializable')).toThrow('none of its artifacts exist')
  })

  it('requires the build cache', () => {
    const rules = parseRequireRules('inherits:Initializable')
    expect(() => findRequiredContracts(root, config, rules)).toThrow('no forge build cache')
    expect(() => findRequiredContracts(root, {...config, cache: false}, rules)).toThrow(
      'enable `cache`'
    )
    fs.mkdirSync(path.join(root, 'cache'))
    fs.writeFileSync(path.join(root, 'cache', 'solidity-files-cache.json'), '{}')
    expect(() => findRequiredContracts(root, config, rules)).toThrow('unexpected forge build cache')
  })
})

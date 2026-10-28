import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {
  parseRequireRules,
  resolveContractSet,
  resolveRemovedContracts,
  resolveRequiredContracts
} from '../src/contracts'

describe('resolveContractSet', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshots-'))
  })

  afterEach(() => {
    fs.rmSync(dir, {recursive: true, force: true})
  })

  it('parses bare names and fully qualified names', () => {
    expect(resolveContractSet('Vault, src/Registry.sol:Registry', dir)).toEqual([
      {name: 'Registry', target: 'src/Registry.sol:Registry'},
      {name: 'Vault', target: 'Vault'}
    ])
  })

  it('supports newline separated entries', () => {
    expect(resolveContractSet('Vault\nRegistry\n', dir)).toEqual([
      {name: 'Registry', target: 'Registry'},
      {name: 'Vault', target: 'Vault'}
    ])
  })

  it('discovers contracts from snapshot files', () => {
    fs.writeFileSync(path.join(dir, 'Vault.json'), '{}')
    fs.writeFileSync(path.join(dir, 'Registry.json'), '{}')
    fs.writeFileSync(path.join(dir, 'README.md'), '')
    expect(resolveContractSet('', dir)).toEqual([
      {name: 'Registry', target: 'Registry'},
      {name: 'Vault', target: 'Vault'}
    ])
  })

  it('lets explicit fully qualified names override discovered entries', () => {
    fs.writeFileSync(path.join(dir, 'Dup.json'), '{}')
    expect(resolveContractSet('src/a/Dup.sol:Dup', dir)).toEqual([
      {name: 'Dup', target: 'src/a/Dup.sol:Dup'}
    ])
  })

  it('returns an empty set when there is nothing to check', () => {
    expect(resolveContractSet('', dir)).toEqual([])
    expect(resolveContractSet('', path.join(dir, 'missing'))).toEqual([])
  })

  it('includes base snapshots even when the current snapshots were deleted', () => {
    fs.writeFileSync(path.join(dir, 'Registry.json'), '{}')
    expect(resolveContractSet('', dir, ['Vault', 'Registry'])).toEqual([
      {name: 'Registry', target: 'Registry'},
      {name: 'Vault', target: 'Vault'}
    ])
    expect(resolveContractSet('src/Vault.sol:Vault', dir, ['Vault'])).toEqual([
      {name: 'Registry', target: 'Registry'},
      {name: 'Vault', target: 'src/Vault.sol:Vault'}
    ])
  })

  it('adds required contracts, which replace snapshot entries but not explicit ones', () => {
    fs.writeFileSync(path.join(dir, 'Vault.json'), '{}')
    const required = [
      {name: 'Vault', target: 'src/Vault.sol:Vault', reason: 'why'},
      {name: 'Module', target: 'src/Module.sol:Module', reason: 'why'}
    ]
    expect(resolveContractSet('', dir, [], required)).toEqual([
      {name: 'Module', target: 'src/Module.sol:Module', reason: 'why'},
      {name: 'Vault', target: 'src/Vault.sol:Vault', reason: 'why'}
    ])
    expect(resolveContractSet('Module', dir, [], required)).toEqual([
      {name: 'Module', target: 'Module'},
      {name: 'Vault', target: 'src/Vault.sol:Vault', reason: 'why'}
    ])
  })

  it('exempts required contracts by bare or fully qualified name', () => {
    const found = [
      {name: 'Dup', source: 'src/a/Dup.sol', rules: ['inherits:Initializable']},
      {name: 'Dup', source: 'src/b/Dup.sol', rules: ['inherits:Initializable']},
      {name: 'Clone', source: 'src/Clone.sol', rules: ['inherits:Initializable']},
      {name: 'Module', source: 'src/Module.sol', rules: ['inherits:Initializable']}
    ]
    const {required, unmatched} = resolveRequiredContracts(
      found,
      'Clone, ./src/a/Dup.sol:Dup\nUnknown'
    )
    expect(required.map(spec => spec.target)).toEqual([
      'src/b/Dup.sol:Dup',
      'src/Module.sol:Module'
    ])
    expect(unmatched).toEqual(['Unknown'])
    expect(resolveRequiredContracts(found, 'Dup,Clone,Module,src/b/Dup.sol:Dup')).toEqual({
      required: [],
      unmatched: []
    })
  })

  it('explains which rules require a contract', () => {
    const {required} = resolveRequiredContracts(
      [
        {
          name: 'A',
          source: 'src/A.sol',
          rules: ['inherits:Initializable', 'inherits:UUPSUpgradeable']
        },
        {name: 'B', source: 'src/B.sol', rules: [], unresolved: true}
      ],
      ''
    )
    expect(required[0].reason).toContain('(`inherits:Initializable`, `inherits:UUPSUpgradeable`)')
    expect(required[1].reason).toContain('not all of its base contracts could be resolved')
    expect(required.every(spec => spec.reason?.includes('`exempt-contracts`'))).toBe(true)
  })

  it('rejects required contracts that share a bare name', () => {
    const found = [
      {name: 'Dup', source: 'src/a/Dup.sol', rules: ['inherits:Initializable']},
      {name: 'Dup', source: 'src/b/Dup.sol', rules: ['inherits:Initializable']}
    ]
    expect(() => resolveRequiredContracts(found, '')).toThrow("share the name 'Dup'")
    expect(() => resolveRequiredContracts(found, '-rf')).toThrow('invalid contract entry')
  })

  it('parses require-snapshots rules', () => {
    expect(
      parseRequireRules(
        'inherits:UUPSUpgradeable\ninherits:./lib/oz/Base.sol:Base, inherits:UUPSUpgradeable'
      )
    ).toEqual([
      {label: 'inherits:UUPSUpgradeable', name: 'UUPSUpgradeable'},
      {
        label: 'inherits:lib/oz/Base.sol:Base',
        name: 'Base',
        source: 'lib/oz/Base.sol'
      }
    ])
    expect(parseRequireRules('')).toEqual([])
    for (const invalid of [
      'true',
      'inherits:',
      'inherits:-rf',
      'inherits:src/A.sol:',
      'Initializable',
      'initializable'
    ]) {
      expect(() => parseRequireRules(invalid)).toThrow('invalid `require-snapshots` rule')
    }
  })

  it('exempts only deliberate removals that had a base snapshot', () => {
    expect(resolveRemovedContracts('Vault, Unknown\nVault', dir, ['Vault'])).toEqual({
      removed: ['Vault'],
      unknown: ['Unknown']
    })
    expect(resolveRemovedContracts('', dir, ['Vault'])).toEqual({removed: [], unknown: []})
  })

  it('rejects removals whose snapshots are still present', () => {
    fs.writeFileSync(path.join(dir, 'Vault.json'), '{}')
    expect(() => resolveRemovedContracts('Vault', dir, ['Vault'])).toThrow(
      "removed contract 'Vault' still has a snapshot"
    )
  })

  it('accepts only bare names for removals', () => {
    expect(() => resolveRemovedContracts('src/Vault.sol:Vault', dir, ['Vault'])).toThrow(
      'expected a bare contract name'
    )
  })

  it('rejects duplicate contract names', () => {
    expect(() => resolveContractSet('src/a/Dup.sol:Dup, src/b/Dup.sol:Dup', dir)).toThrow(
      "duplicate contract name 'Dup'"
    )
  })

  it('rejects entries that are not contract identifiers', () => {
    expect(() => resolveContractSet('-rf', dir)).toThrow('invalid contract entry')
    expect(() => resolveContractSet('src/A.sol:', dir)).toThrow('invalid contract entry')
    expect(() => resolveContractSet('name with space', dir)).toThrow('invalid contract entry')
  })

  it('rejects snapshot files that are not contract names', () => {
    fs.writeFileSync(path.join(dir, 'not a contract.json'), '{}')
    expect(() => resolveContractSet('', dir)).toThrow('does not map to a contract name')
  })
})

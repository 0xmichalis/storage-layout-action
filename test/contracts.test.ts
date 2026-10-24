import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {resolveContractSet, resolveRemovedContracts} from '../src/contracts'

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

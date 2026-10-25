import * as fs from 'fs'
import * as path from 'path'
import {describe, expect, it} from 'vitest'

import {deepEqual, diffLayouts, normalizeLayout, parseLayout} from '../src/layout'
import {RawLayout} from '../src/types'

const vaultSnapshot = fs.readFileSync(
  path.join(__dirname, 'fixture-project', 'storage-layouts', 'Vault.json'),
  'utf8'
)

describe('parseLayout', () => {
  it('parses forge inspect output', () => {
    const layout = parseLayout(vaultSnapshot)
    expect(layout.storage.map(item => item.label)).toEqual([
      'manager',
      'paused',
      'totalShares',
      'positions',
      'status',
      '__gap'
    ])
  })

  it('rejects invalid JSON', () => {
    expect(() => parseLayout('{nope')).toThrow('invalid JSON')
  })

  it('rejects JSON without a storage array', () => {
    expect(() => parseLayout('{"types":{}}')).toThrow('expected an object with a `storage` array')
  })
})

describe('normalizeLayout', () => {
  it('strips astId and stabilizes type identifiers', () => {
    const normalized = normalizeLayout(parseLayout(vaultSnapshot))

    const positions = normalized.storage.find(item => item.label === 'positions')
    expect(positions).toEqual({
      label: 'positions',
      offset: 0,
      slot: '2',
      type: 't_mapping(t_address,t_struct(Position)storage)',
      contract: 'src/Vault.sol:Vault'
    })

    const struct = normalized.types['t_struct(Position)storage']
    expect(struct.members).toEqual([
      {label: 'amount0', offset: 0, slot: '0', type: 't_uint128'},
      {label: 'amount1', offset: 16, slot: '0', type: 't_uint128'},
      {label: 'owner', offset: 0, slot: '1', type: 't_address'},
      {label: 'status', offset: 20, slot: '1', type: 't_enum(Status)'}
    ])
    expect(JSON.stringify(normalized)).not.toContain('astId')
  })

  it('is insensitive to astId churn', () => {
    const original = parseLayout(vaultSnapshot)
    const churned = JSON.parse(
      vaultSnapshot
        .replace(/"astId": (\d+)/g, (_, id) => `"astId": ${Number(id) + 1000}`)
        .replace(/\(Position\)\d+_/g, '(Position)777_')
        .replace(/\(Status\)\d+/g, '(Status)888')
    ) as RawLayout

    expect(deepEqual(normalizeLayout(original), normalizeLayout(churned))).toBe(true)
  })

  it('is idempotent', () => {
    const once = normalizeLayout(parseLayout(vaultSnapshot))
    const twice = normalizeLayout(once)
    expect(deepEqual(once, twice)).toBe(true)
  })

  it('tolerates a missing types map', () => {
    const normalized = normalizeLayout({storage: [], types: null})
    expect(normalized).toEqual({storage: [], types: {}})
  })

  it('rejects layouts referencing undefined types', () => {
    const truncated = parseLayout(vaultSnapshot)
    delete (truncated.types as Record<string, unknown>)['t_uint128']
    expect(() => normalizeLayout(truncated)).toThrow(
      'layout references types with no definition: t_uint128'
    )

    const retyped = parseLayout(vaultSnapshot)
    retyped.storage[2] = {...retyped.storage[2], type: 't_uint64'}
    expect(() => normalizeLayout(retyped)).toThrow(
      'layout references types with no definition: t_uint64'
    )
  })

  it('rejects distinct same-named structs from different scopes', () => {
    // solc scopes structs by contract: PoolA.Info and PoolB.Info share a
    // short name but have distinct raw type ids. Reordering PoolB.Info's
    // members must not disappear when both ids stabilize to one key.
    const colliding: RawLayout = {
      storage: [
        {
          label: 'poolA',
          offset: 0,
          slot: '0',
          type: 't_struct(Info)6_storage',
          contract: 'src/PoolA.sol:PoolA'
        },
        {
          label: 'poolB',
          offset: 0,
          slot: '1',
          type: 't_struct(Info)12_storage',
          contract: 'src/PoolB.sol:PoolB'
        }
      ],
      types: {
        't_struct(Info)6_storage': {
          encoding: 'inplace',
          label: 'struct PoolA.Info',
          numberOfBytes: '64',
          members: [
            {label: 'total', offset: 0, slot: '0', type: 't_uint256'},
            {label: 'liquidity', offset: 0, slot: '1', type: 't_uint128'}
          ]
        },
        't_struct(Info)12_storage': {
          encoding: 'inplace',
          label: 'struct PoolB.Info',
          numberOfBytes: '64',
          members: [
            {label: 'liquidity', offset: 0, slot: '0', type: 't_uint128'},
            {label: 'total', offset: 0, slot: '1', type: 't_uint256'}
          ]
        },
        t_uint128: {encoding: 'inplace', label: 'uint128', numberOfBytes: '16'},
        t_uint256: {encoding: 'inplace', label: 'uint256', numberOfBytes: '32'}
      }
    }
    let message = ''
    try {
      normalizeLayout(colliding)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toBe(
      'distinct types share the identifier t_struct(Info)storage (struct PoolA.Info vs struct PoolB.Info); the storage layout cannot be compared safely'
    )
  })
})

describe('deepEqual', () => {
  it('ignores object key order', () => {
    expect(deepEqual({a: 1, b: {c: 2, d: 3}}, {b: {d: 3, c: 2}, a: 1})).toBe(true)
  })

  it('respects array order', () => {
    expect(deepEqual([1, 2], [2, 1])).toBe(false)
  })

  it('distinguishes missing keys from undefined', () => {
    expect(deepEqual({a: 1}, {a: 1, b: 2})).toBe(false)
  })
})

describe('diffLayouts', () => {
  const base = normalizeLayout(parseLayout(vaultSnapshot))

  it('reports appended variables', () => {
    const changed = structuredClone(base)
    changed.storage.push({label: 'fee', offset: 0, slot: '49', type: 't_uint256'})
    expect(diffLayouts(base, changed)).toEqual(['+ fee: t_uint256 (slot 49 offset 0)'])
  })

  it('reports removed and changed variables', () => {
    const changed = structuredClone(base)
    changed.storage = changed.storage.filter(item => item.label !== '__gap')
    changed.storage[0] = {...changed.storage[0], type: 't_uint160'}
    const lines = diffLayouts(base, changed)
    expect(lines).toContain('~ slot 0 offset 0: manager (t_address) -> manager (t_uint160)')
    expect(lines).toContain('- __gap: t_array(t_uint256)46_storage (slot 4 offset 0)')
  })

  it('reports type definition changes', () => {
    const changed = structuredClone(base)
    changed.types['t_struct(Position)storage'] = {
      ...changed.types['t_struct(Position)storage'],
      numberOfBytes: '96'
    }
    expect(diffLayouts(base, changed)).toEqual([
      '~ type t_struct(Position)storage: definition changed'
    ])
  })
})

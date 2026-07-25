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
      {label: 'owner', offset: 0, slot: '1', type: 't_address'}
    ])
    expect(JSON.stringify(normalized)).not.toContain('astId')
  })

  it('is insensitive to astId churn', () => {
    const original = parseLayout(vaultSnapshot)
    const churned = JSON.parse(
      vaultSnapshot.replace(/"astId": (\d+)/g, (_, id) => `"astId": ${Number(id) + 1000}`)
    ) as RawLayout
    for (const [id, type] of Object.entries(churned.types ?? {})) {
      if (id.includes('(Position)8_')) {
        delete (churned.types as Record<string, unknown>)[id]
        ;(churned.types as Record<string, unknown>)[id.replace('(Position)8_', '(Position)77_')] =
          type
      }
    }
    churned.storage = churned.storage.map(item => ({
      ...item,
      type: item.type.replace('(Position)8_', '(Position)77_')
    }))

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
    expect(lines).toContain('- __gap: t_array(t_uint256)46_storage (slot 3 offset 0)')
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

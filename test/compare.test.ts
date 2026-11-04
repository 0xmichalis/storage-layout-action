import {describe, expect, it} from 'vitest'

import {checkCompatibility} from '../src/compare'
import {NormalizedLayout} from '../src/types'

const TYPES: NormalizedLayout['types'] = {
  t_address: {encoding: 'inplace', label: 'address', numberOfBytes: '20'},
  t_bool: {encoding: 'inplace', label: 'bool', numberOfBytes: '1'},
  t_uint256: {encoding: 'inplace', label: 'uint256', numberOfBytes: '32'},
  't_array(t_uint256)48_storage': {
    encoding: 'inplace',
    label: 'uint256[48]',
    numberOfBytes: '1536',
    base: 't_uint256'
  },
  't_array(t_uint256)47_storage': {
    encoding: 'inplace',
    label: 'uint256[47]',
    numberOfBytes: '1504',
    base: 't_uint256'
  }
}

const CONTRACT = 'src/Vault.sol:Vault'

const base: NormalizedLayout = {
  storage: [
    {label: 'owner', offset: 0, slot: '0', type: 't_address', contract: CONTRACT},
    {label: 'paused', offset: 20, slot: '0', type: 't_bool', contract: CONTRACT},
    {label: 'shares', offset: 0, slot: '1', type: 't_uint256', contract: CONTRACT},
    {
      label: '__gap',
      offset: 0,
      slot: '2',
      type: 't_array(t_uint256)48_storage',
      contract: CONTRACT
    }
  ],
  types: TYPES
}

const withStorage = (storage: NormalizedLayout['storage']): NormalizedLayout => ({
  storage,
  types: TYPES
})

describe('checkCompatibility', () => {
  it('accepts an identical layout', () => {
    expect(checkCompatibility(base, base, false).pass).toBe(true)
  })

  it('accepts appended variables', () => {
    const upgraded = withStorage([
      ...base.storage,
      {label: 'fee', offset: 0, slot: '50', type: 't_uint256', contract: CONTRACT}
    ])
    expect(checkCompatibility(base, upgraded, false).pass).toBe(true)
  })

  it('accepts variables that consume the storage gap', () => {
    const upgraded = withStorage([
      ...base.storage.slice(0, 3),
      {label: 'fee', offset: 0, slot: '2', type: 't_uint256', contract: CONTRACT},
      {
        label: '__gap',
        offset: 0,
        slot: '3',
        type: 't_array(t_uint256)47_storage',
        contract: CONTRACT
      }
    ])
    expect(checkCompatibility(base, upgraded, false).pass).toBe(true)
  })

  it('rejects variables inserted before existing ones', () => {
    const upgraded = withStorage([
      {label: 'sneaky', offset: 0, slot: '0', type: 't_address', contract: CONTRACT},
      {label: 'owner', offset: 0, slot: '1', type: 't_address', contract: CONTRACT},
      {label: 'paused', offset: 20, slot: '1', type: 't_bool', contract: CONTRACT},
      {label: 'shares', offset: 0, slot: '2', type: 't_uint256', contract: CONTRACT},
      {
        label: '__gap',
        offset: 0,
        slot: '3',
        type: 't_array(t_uint256)48_storage',
        contract: CONTRACT
      }
    ])
    const result = checkCompatibility(base, upgraded, false)
    expect(result.pass).toBe(false)
    expect(result.explanation).toContain('Inserted `sneaky`')
  })

  it('rejects type changes', () => {
    const upgraded = withStorage(
      base.storage.map(item => (item.label === 'shares' ? {...item, type: 't_address'} : item))
    )
    const result = checkCompatibility(base, upgraded, false)
    expect(result.pass).toBe(false)
    expect(result.explanation).toContain('shares')
  })

  it('rejects deleted variables and mentions the declaring contract', () => {
    const upgraded = withStorage(base.storage.filter(item => item.label !== 'paused'))
    const result = checkCompatibility(base, upgraded, false)
    expect(result.pass).toBe(false)
    expect(result.explanation).toContain('Deleted `paused`')
    expect(result.explanation).toContain(CONTRACT)
    expect(result.explanation).not.toContain('undefined:')
  })

  it('gates renames behind unsafeAllowRenames', () => {
    const upgraded = withStorage(
      base.storage.map(item => (item.label === 'shares' ? {...item, label: 'sharesTotal'} : item))
    )
    expect(checkCompatibility(base, upgraded, false).pass).toBe(false)
    expect(checkCompatibility(base, upgraded, true).pass).toBe(true)
  })

  it('accepts identical layouts containing enums, whose members solc omits', () => {
    const withEnum: NormalizedLayout = {
      storage: [
        {label: 'status', offset: 0, slot: '0', type: 't_enum(Status)', contract: CONTRACT},
        ...base.storage.map(item => ({...item, slot: String(Number(item.slot) + 1)}))
      ],
      types: {
        ...TYPES,
        't_enum(Status)': {encoding: 'inplace', label: 'enum Status', numberOfBytes: '1'}
      }
    }
    expect(checkCompatibility(withEnum, withEnum, false).pass).toBe(true)
  })

  it('rejects struct member changes even when the struct contains an enum', () => {
    const structWithEnum = (memberType: string): NormalizedLayout => ({
      storage: [
        {
          label: 'position',
          offset: 0,
          slot: '0',
          type: 't_struct(Position)storage',
          contract: CONTRACT
        }
      ],
      types: {
        ...TYPES,
        't_enum(Status)': {encoding: 'inplace', label: 'enum Status', numberOfBytes: '1'},
        't_struct(Position)storage': {
          encoding: 'inplace',
          label: 'struct Position',
          numberOfBytes: '64',
          members: [
            {label: 'status', offset: 0, slot: '0', type: 't_enum(Status)'},
            {label: 'amount', offset: 0, slot: '1', type: memberType}
          ]
        }
      }
    })
    expect(
      checkCompatibility(structWithEnum('t_uint256'), structWithEnum('t_uint256'), false).pass
    ).toBe(true)
    const result = checkCompatibility(
      structWithEnum('t_uint256'),
      structWithEnum('t_address'),
      false
    )
    expect(result.pass).toBe(false)
    expect(result.explanation).toContain('amount')
  })

  it('rejects a growing storage gap', () => {
    const upgraded = withStorage([
      ...base.storage.slice(0, 3),
      {
        label: '__gap',
        offset: 0,
        slot: '2',
        type: 't_array(t_uint256)49_storage',
        contract: CONTRACT
      }
    ])
    const withGrownGap: NormalizedLayout = {
      storage: upgraded.storage,
      types: {
        ...TYPES,
        't_array(t_uint256)49_storage': {
          encoding: 'inplace',
          label: 'uint256[49]',
          numberOfBytes: '1568',
          base: 't_uint256'
        }
      }
    }
    expect(checkCompatibility(base, withGrownGap, false).pass).toBe(false)
  })
})

describe('checkCompatibility with ERC-7201 namespaces', () => {
  const LOCATION = 'erc7201:example.main'
  const NS_BASE = 10958655983261152271848436692291137275443024275653522991983264966744321209600n
  const at = (label: string, slot: bigint, type = 't_uint256') => ({
    label,
    offset: 0,
    slot: slot.toString(),
    type,
    contract: CONTRACT
  })
  const withNamespace = (items: NormalizedLayout['storage']): NormalizedLayout => ({
    ...base,
    namespaces: {[LOCATION]: {storage: items, types: TYPES}}
  })
  const namespaced = withNamespace([at('total', NS_BASE), at('owner', NS_BASE + 1n, 't_address')])

  it('accepts an identical namespaced layout', () => {
    expect(checkCompatibility(namespaced, namespaced, false).pass).toBe(true)
  })

  it('accepts a namespace the base did not report', () => {
    expect(checkCompatibility(base, namespaced, false).pass).toBe(true)
  })

  it('accepts members appended to a namespace', () => {
    const upgraded = withNamespace([
      ...namespaced.namespaces![LOCATION].storage,
      at('fee', NS_BASE + 2n)
    ])
    expect(checkCompatibility(namespaced, upgraded, false).pass).toBe(true)
  })

  it('rejects members inserted into a namespace', () => {
    const upgraded = withNamespace([
      at('sneaky', NS_BASE),
      at('total', NS_BASE + 1n),
      at('owner', NS_BASE + 2n, 't_address')
    ])
    const result = checkCompatibility(namespaced, upgraded, false)
    expect(result.pass).toBe(false)
    expect(result.explanation).toContain('Inserted `sneaky`')
  })

  it('rejects namespace member type changes', () => {
    const upgraded = withNamespace([
      at('total', NS_BASE, 't_address'),
      at('owner', NS_BASE + 1n, 't_address')
    ])
    expect(checkCompatibility(namespaced, upgraded, false).pass).toBe(false)
  })

  it('rejects a deleted namespace', () => {
    const result = checkCompatibility(namespaced, base, false)
    expect(result.pass).toBe(false)
    expect(result.explanation).toContain(LOCATION)
  })

  it('checks struct members against the types of their namespace', () => {
    const struct = (members: [string, string][]): NormalizedLayout['types'] => ({
      ...TYPES,
      't_struct(Info)storage': {
        encoding: 'inplace',
        label: 'struct Info',
        numberOfBytes: String(32 * members.length),
        members: members.map(([label, type], i) => ({label, offset: 0, slot: String(i), type}))
      }
    })
    const layout = (members: [string, string][]): NormalizedLayout => ({
      ...base,
      types: struct([['unrelated', 't_address']]),
      namespaces: {
        [LOCATION]: {
          storage: [at('info', NS_BASE, 't_struct(Info)storage')],
          types: struct(members)
        }
      }
    })
    const before = layout([['total', 't_uint256']])
    expect(checkCompatibility(before, before, false).pass).toBe(true)
    expect(
      checkCompatibility(
        before,
        layout([
          ['sneaky', 't_uint256'],
          ['total', 't_uint256']
        ]),
        false
      ).pass
    ).toBe(false)
  })
})

import {stabilizeTypeIdentifier} from '@openzeppelin/upgrades-core'

import {NormalizedLayout, NormalizedStorageItem, NormalizedType, RawLayout, RawType} from './types'

/**
 * Reduces a layout to its semantically relevant fields and stabilizes all
 * type identifiers. Accepts both raw `forge inspect` output and already
 * normalized layouts, so snapshots can be committed in either form.
 */
export function normalizeLayout(raw: RawLayout): NormalizedLayout {
  if (!Array.isArray(raw.storage)) {
    throw new Error('invalid layout: missing `storage` array')
  }

  const storage: NormalizedStorageItem[] = raw.storage.map(item => {
    const normalized: NormalizedStorageItem = {
      label: item.label,
      offset: item.offset,
      slot: item.slot,
      type: stabilizeTypeIdentifier(item.type)
    }
    if (item.contract !== undefined) normalized.contract = item.contract
    return normalized
  })

  const types: Record<string, NormalizedType> = {}
  for (const [id, type] of Object.entries(raw.types ?? {})) {
    types[stabilizeTypeIdentifier(id)] = normalizeType(type)
  }

  const layout = {storage, types}
  assertTypeReferencesResolve(layout)
  return layout
}

/**
 * The comparison engine silently treats type identifiers that are missing
 * from the `types` map as compatible with anything, so a truncated or
 * hand-edited snapshot could sneak past the compatibility check. Fail
 * closed instead: solc always emits an entry for every referenced type.
 */
function assertTypeReferencesResolve(layout: NormalizedLayout): void {
  const missing = new Set<string>()
  const needs = (id: string): void => {
    if (layout.types[id] === undefined) missing.add(id)
  }
  for (const item of layout.storage) needs(item.type)
  for (const type of Object.values(layout.types)) {
    type.members?.forEach(member => needs(member.type))
    if (type.base !== undefined) needs(type.base)
    if (type.key !== undefined) needs(type.key)
    if (type.value !== undefined) needs(type.value)
  }
  if (missing.size > 0) {
    throw new Error(
      `layout references types with no definition: ${[...missing].sort().join(', ')}; regenerate the snapshot with forge inspect`
    )
  }
}

function normalizeType(type: RawType): NormalizedType {
  const normalized: NormalizedType = {}
  if (type.encoding !== undefined) normalized.encoding = type.encoding
  if (type.label !== undefined) normalized.label = type.label
  if (type.numberOfBytes !== undefined) normalized.numberOfBytes = type.numberOfBytes
  if (type.members !== undefined) {
    normalized.members = type.members.map(member => ({
      label: member.label,
      offset: member.offset,
      slot: member.slot,
      type: stabilizeTypeIdentifier(member.type)
    }))
  }
  if (type.base !== undefined) normalized.base = stabilizeTypeIdentifier(type.base)
  if (type.key !== undefined) normalized.key = stabilizeTypeIdentifier(type.key)
  if (type.value !== undefined) normalized.value = stabilizeTypeIdentifier(type.value)
  return normalized
}

export function parseLayout(json: string): RawLayout {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as RawLayout).storage)
  ) {
    throw new Error('invalid layout: expected an object with a `storage` array')
  }
  return parsed as RawLayout
}

/** Deep equality; object key order insensitive, array order sensitive. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const keysA = Object.keys(a).sort()
    const keysB = Object.keys(b).sort()
    if (!deepEqual(keysA, keysB)) return false
    return keysA.every(key =>
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    )
  }
  return false
}

/**
 * Human-readable difference between two normalized layouts, used to explain
 * why a committed snapshot no longer matches the current code.
 */
export function diffLayouts(before: NormalizedLayout, after: NormalizedLayout): string[] {
  const lines: string[] = []
  const location = (item: NormalizedStorageItem): string =>
    `slot ${item.slot} offset ${item.offset}`
  const key = (item: NormalizedStorageItem): string => `${item.slot}:${item.offset}`

  const beforeByKey = new Map(before.storage.map(item => [key(item), item]))
  const afterByKey = new Map(after.storage.map(item => [key(item), item]))

  for (const [k, item] of beforeByKey) {
    const other = afterByKey.get(k)
    if (other === undefined) {
      lines.push(`- ${item.label}: ${item.type} (${location(item)})`)
    } else if (item.label !== other.label || item.type !== other.type) {
      lines.push(
        `~ ${location(item)}: ${item.label} (${item.type}) -> ${other.label} (${other.type})`
      )
    } else if (item.contract !== other.contract) {
      lines.push(`~ ${item.label}: contract changed ${item.contract} -> ${other.contract}`)
    }
  }
  for (const [k, item] of afterByKey) {
    if (!beforeByKey.has(k)) {
      lines.push(`+ ${item.label}: ${item.type} (${location(item)})`)
    }
  }

  const typeIds = new Set([...Object.keys(before.types), ...Object.keys(after.types)])
  for (const id of typeIds) {
    const beforeType = before.types[id]
    const afterType = after.types[id]
    if (beforeType === undefined) {
      lines.push(`+ type ${id}`)
    } else if (afterType === undefined) {
      lines.push(`- type ${id}`)
    } else if (!deepEqual(beforeType, afterType)) {
      lines.push(`~ type ${id}: definition changed`)
    }
  }

  return lines
}

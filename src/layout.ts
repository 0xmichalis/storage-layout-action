import {stabilizeTypeIdentifier} from '@openzeppelin/upgrades-core'

import {
  NormalizedLayout,
  NormalizedStorageItem,
  NormalizedType,
  RawLayout,
  RawStorageItem,
  RawType
} from './types'

/**
 * forge inspect (1.9 and later) appends the members of ERC-7201 namespaces to
 * `storage`, labelled `<namespace id>.<member>` at their absolute slots, and
 * scopes every type identifier they reference as `erc7201(<namespace id>)::`
 * (foundry-rs/foundry#17869). The comparison engine cannot parse the scoped
 * identifiers and compares namespaces separately, keyed by storage location.
 */
const NAMESPACED_TYPE = /^erc7201\((.+?)\)::(.+)$/

function splitNamespace(typeId: string): {namespace?: string; type: string} {
  const match = NAMESPACED_TYPE.exec(typeId)
  return match === null ? {type: typeId} : {namespace: match[1], type: match[2]}
}

function stabilize(typeId: string): string {
  return stabilizeTypeIdentifier(splitNamespace(typeId).type)
}

function normalizeItem(item: RawStorageItem, label = item.label): NormalizedStorageItem {
  const normalized: NormalizedStorageItem = {
    label,
    offset: item.offset,
    slot: item.slot,
    type: stabilize(item.type)
  }
  if (item.contract !== undefined) normalized.contract = item.contract
  return normalized
}

/**
 * Reduces a layout to its semantically relevant fields and stabilizes all
 * type identifiers. Accepts both raw `forge inspect` output and already
 * normalized layouts, so snapshots can be committed in either form.
 */
export function normalizeLayout(raw: RawLayout): NormalizedLayout {
  if (!Array.isArray(raw.storage)) {
    throw new Error('invalid layout: missing `storage` array')
  }

  const storage: NormalizedStorageItem[] = []
  const namespaces: Record<string, NormalizedStorageItem[]> = {}
  for (const item of raw.storage) {
    const {namespace} = splitNamespace(item.type)
    if (namespace === undefined) {
      storage.push(normalizeItem(item))
      continue
    }
    const prefix = `${namespace}.`
    const label = item.label.startsWith(prefix) ? item.label.slice(prefix.length) : item.label
    ;(namespaces[`erc7201:${namespace}`] ??= []).push(normalizeItem(item, label))
  }
  for (const [location, items] of Object.entries(raw.namespaces ?? {})) {
    ;(namespaces[location] ??= []).push(...items.map(item => normalizeItem(item)))
  }

  const types: Record<string, NormalizedType> = {}
  for (const [id, type] of Object.entries(raw.types ?? {})) {
    const key = stabilize(id)
    const normalized = normalizeType(type)
    // Stabilization drops the AST id, so distinct scoped types can share a
    // key (struct PoolA.Info and struct PoolB.Info both become
    // t_struct(Info)storage). Silently keeping one definition would hide
    // changes to the other, so fail closed when the definitions differ.
    const previous = types[key]
    if (
      previous !== undefined &&
      !deepEqual({...previous, label: undefined}, {...normalized, label: undefined})
    ) {
      throw new Error(
        `distinct types share the identifier ${key} (${previous.label} vs ${normalized.label}); the storage layout cannot be compared safely`
      )
    }
    types[key] = normalized
  }

  const layout: NormalizedLayout = {storage, types}
  if (Object.keys(namespaces).length > 0) layout.namespaces = namespaces
  assertTypeReferencesResolve(layout)
  return layout
}

/** Plain storage followed by namespaced items, each with its namespace. */
function allItems(layout: NormalizedLayout): {item: NormalizedStorageItem; namespace?: string}[] {
  return [
    ...layout.storage.map(item => ({item})),
    ...Object.entries(layout.namespaces ?? {}).flatMap(([namespace, items]) =>
      items.map(item => ({item, namespace}))
    )
  ]
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
  for (const {item} of allItems(layout)) needs(item.type)
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
      type: stabilize(member.type)
    }))
  }
  if (type.base !== undefined) normalized.base = stabilize(type.base)
  if (type.key !== undefined) normalized.key = stabilize(type.key)
  if (type.value !== undefined) normalized.value = stabilize(type.value)
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
  type Entry = {item: NormalizedStorageItem; location: string}
  const byPosition = (layout: NormalizedLayout): Map<string, Entry> =>
    new Map(
      allItems(layout).map(({item, namespace}) => {
        const position = `slot ${item.slot} offset ${item.offset}`
        const location = namespace === undefined ? position : `${namespace} ${position}`
        return [location, {item, location}]
      })
    )

  const beforeByKey = byPosition(before)
  const afterByKey = byPosition(after)

  for (const [k, {item, location}] of beforeByKey) {
    const other = afterByKey.get(k)?.item
    if (other === undefined) {
      lines.push(`- ${item.label}: ${item.type} (${location})`)
    } else if (item.label !== other.label || item.type !== other.type) {
      lines.push(`~ ${location}: ${item.label} (${item.type}) -> ${other.label} (${other.type})`)
    } else if (item.contract !== other.contract) {
      lines.push(`~ ${item.label}: contract changed ${item.contract} -> ${other.contract}`)
    }
  }
  for (const [k, {item, location}] of afterByKey) {
    if (!beforeByKey.has(k)) {
      lines.push(`+ ${item.label}: ${item.type} (${location})`)
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

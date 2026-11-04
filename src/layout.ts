import {stabilizeTypeIdentifier} from '@openzeppelin/upgrades-core'

import {
  NormalizedLayout,
  NormalizedSection,
  NormalizedStorageItem,
  NormalizedType,
  RawLayout,
  RawSection,
  RawStorageItem,
  RawType
} from './types'

/**
 * forge inspect (1.9 and later) appends the members of ERC-7201 namespaces to
 * `storage`, labelled `<namespace id>.<member>` at their absolute slots, and
 * scopes every type they reference as `erc7201(<namespace id>)::<type>`
 * (foundry-rs/foundry#17869). The comparison engine cannot parse scoped
 * identifiers, so each namespace becomes its own section, keyed by storage
 * location (`erc7201:<namespace id>`) and with its own types. Separate types
 * keep same-named structs of different namespaces apart, as forge's scoping
 * does.
 */
const NAMESPACED_TYPE = /^erc7201\((.+?)\)::(.+)$/

function splitNamespace(typeId: string): {namespace?: string; type: string} {
  const match = NAMESPACED_TYPE.exec(typeId)
  return match === null ? {type: typeId} : {namespace: match[1], type: match[2]}
}

function stabilize(typeId: string): string {
  return stabilizeTypeIdentifier(splitNamespace(typeId).type)
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

  type Section = {storage: RawStorageItem[]; types: Record<string, RawType>}
  const plain: Section = {storage: [], types: {}}
  // Normalized snapshots already hold their namespaces apart.
  const scoped: Record<string, Section> = Object.fromEntries(
    Object.entries(raw.namespaces ?? {}).map(([location, section]) => [
      location,
      {storage: [...section.storage], types: {...section.types}}
    ])
  )
  const sectionOf = (namespace: string | undefined): Section =>
    namespace === undefined ? plain : (scoped[`erc7201:${namespace}`] ??= {storage: [], types: {}})
  for (const item of raw.storage) {
    const {namespace} = splitNamespace(item.type)
    const prefix = `${namespace}.`
    const label =
      namespace !== undefined && item.label.startsWith(prefix)
        ? item.label.slice(prefix.length)
        : item.label
    sectionOf(namespace).storage.push({...item, label})
  }
  for (const [id, type] of Object.entries(raw.types ?? {})) {
    sectionOf(splitNamespace(id).namespace).types[id] = type
  }

  const layout: NormalizedLayout = normalizeSection(plain)
  const locations = Object.keys(scoped)
  if (locations.length > 0) {
    layout.namespaces = Object.fromEntries(
      locations.map(location => [location, normalizeSection(scoped[location], location)])
    )
  }
  return layout
}

function normalizeSection(raw: RawSection, location?: string): NormalizedSection {
  const where = location === undefined ? '' : ` in ${location}`
  const storage: NormalizedStorageItem[] = raw.storage.map(item => {
    const normalized: NormalizedStorageItem = {
      label: item.label,
      offset: item.offset,
      slot: item.slot,
      type: stabilize(item.type)
    }
    if (item.contract !== undefined) normalized.contract = item.contract
    return normalized
  })

  const types: Record<string, NormalizedType> = {}
  for (const [id, type] of Object.entries(raw.types ?? {})) {
    const key = stabilize(id)
    const normalized = normalizeType(type)
    // Stabilization drops the AST id, so distinct scoped types can share a
    // key (struct PoolA.Info and struct PoolB.Info both become
    // t_struct(Info)storage). Silently keeping one definition would hide
    // changes to the other, so fail closed when the definitions differ.
    const previous = types[key]
    if (previous !== undefined) {
      if (!deepEqual({...previous, label: undefined}, {...normalized, label: undefined})) {
        throw new Error(
          `distinct types share the identifier ${key}${where} (${previous.label} vs ${normalized.label}); the storage layout cannot be compared safely`
        )
      }
      // Identical definitions under different labels: keep the smaller label
      // so the result does not depend on the order of the AST ids.
      if ((previous.label ?? '') <= (normalized.label ?? '')) continue
    }
    types[key] = normalized
  }

  const section = {storage, types}
  assertTypeReferencesResolve(section, where)
  return section
}

/**
 * The comparison engine silently treats type identifiers that are missing
 * from the `types` map as compatible with anything, so a truncated or
 * hand-edited snapshot could sneak past the compatibility check. Fail
 * closed instead: solc always emits an entry for every referenced type.
 */
function assertTypeReferencesResolve(section: NormalizedSection, where: string): void {
  const missing = new Set<string>()
  const needs = (id: string): void => {
    if (section.types[id] === undefined) missing.add(id)
  }
  for (const item of section.storage) needs(item.type)
  for (const type of Object.values(section.types)) {
    type.members?.forEach(member => needs(member.type))
    if (type.base !== undefined) needs(type.base)
    if (type.key !== undefined) needs(type.key)
    if (type.value !== undefined) needs(type.value)
  }
  if (missing.size > 0) {
    throw new Error(
      `layout references types with no definition${where}: ${[...missing].sort().join(', ')}; regenerate the snapshot with forge inspect`
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
  const lines = diffSection(before, after, '')
  const empty: NormalizedSection = {storage: [], types: {}}
  const locations = new Set([
    ...Object.keys(before.namespaces ?? {}),
    ...Object.keys(after.namespaces ?? {})
  ])
  for (const location of locations) {
    lines.push(
      ...diffSection(
        before.namespaces?.[location] ?? empty,
        after.namespaces?.[location] ?? empty,
        `${location} `
      )
    )
  }
  return lines
}

function diffSection(before: NormalizedSection, after: NormalizedSection, where: string): string[] {
  const lines: string[] = []
  const location = (item: NormalizedStorageItem): string =>
    `${where}slot ${item.slot} offset ${item.offset}`
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
      lines.push(`+ type ${where}${id}`)
    } else if (afterType === undefined) {
      lines.push(`- type ${where}${id}`)
    } else if (!deepEqual(beforeType, afterType)) {
      lines.push(`~ type ${where}${id}: definition changed`)
    }
  }

  return lines
}

import {stabilizeTypeIdentifier} from '@openzeppelin/upgrades-core'
import {closeSync, constants as fsFlags, fstatSync, openSync, readSync} from 'node:fs'

import {MAX_COMMAND_OUTPUT_BYTES} from './run'
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
const SLOT_BYTES = 32
const SLOT_MAX = (1n << 256n) - 1n
const SLOT_MAX_DECIMAL = SLOT_MAX.toString()
const TYPE_BYTES_MAX_DECIMAL = (SLOT_MAX * BigInt(SLOT_BYTES)).toString()

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
  const positions = new Set<string>()
  const storage: NormalizedStorageItem[] = raw.storage.map(item => {
    const position = storagePosition(item)
    if (positions.has(position)) {
      throw new Error(`invalid layout: duplicate slot ${item.slot} offset ${item.offset}${where}`)
    }
    positions.add(position)
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
      if (previous.label <= normalized.label) continue
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
    if (!Object.hasOwn(section.types, id)) missing.add(id)
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
  const normalized: NormalizedType = {label: type.label, numberOfBytes: type.numberOfBytes}
  if (type.encoding !== undefined) normalized.encoding = type.encoding
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

/** Uses the same size limit for working tree files as for git and forge output. */
export function readSnapshot(file: string): RawLayout {
  const fd = openSync(file, fsFlags.O_RDONLY | fsFlags.O_NONBLOCK)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new Error('snapshot must be a regular file')
    const {size} = stat
    if (size > MAX_COMMAND_OUTPUT_BYTES) {
      throw new Error(`snapshot exceeds ${MAX_COMMAND_OUTPUT_BYTES} bytes`)
    }
    const buffer = Buffer.alloc(size + 1)
    let length = 0
    while (length < buffer.length) {
      const read = readSync(fd, buffer, length, buffer.length - length, null)
      if (read === 0) break
      length += read
    }
    if (length !== size) throw new Error('snapshot size changed during read')
    return parseLayout(buffer.toString('utf8', 0, length))
  } finally {
    closeSync(fd)
  }
}

export function parseLayout(json: string): RawLayout {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.storage)) {
    throw new Error('invalid layout: expected an object with a `storage` array')
  }
  assertSection(parsed, 'layout')
  if (parsed.namespaces !== undefined) {
    if (!isRecord(parsed.namespaces))
      throw new Error('invalid layout: `namespaces` must be an object')
    for (const [location, section] of Object.entries(parsed.namespaces)) {
      if (!location.startsWith('erc7201:') || location === 'erc7201:') {
        throw new Error('invalid layout: expected an ERC-7201 namespace location')
      }
      assertSection(section, location)
    }
  }
  return parsed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDecimal(value: unknown, max: string): value is string {
  return (
    typeof value === 'string' &&
    value.length <= max.length &&
    /^(0|[1-9][0-9]*)$/.test(value) &&
    (value.length < max.length || value <= max)
  )
}

function isTypeId(value: unknown): value is string {
  return typeof value === 'string' && /^t_.+/.test(splitNamespace(value).type)
}

function assertItems(items: unknown[], where: string): void {
  for (const [index, item] of items.entries()) {
    if (
      !isRecord(item) ||
      typeof item.label !== 'string' ||
      item.label === '' ||
      !isDecimal(item.slot, SLOT_MAX_DECIMAL) ||
      typeof item.offset !== 'number' ||
      !Number.isInteger(item.offset) ||
      item.offset < 0 ||
      item.offset >= SLOT_BYTES ||
      !isTypeId(item.type) ||
      (item.contract !== undefined && typeof item.contract !== 'string')
    ) {
      throw new Error(`invalid layout: ${where}[${index}] has invalid storage fields`)
    }
  }
}

function assertSection(section: unknown, where: string): asserts section is RawSection {
  if (!isRecord(section) || !Array.isArray(section.storage)) {
    throw new Error(`invalid layout: ${where} must have a storage array`)
  }
  assertItems(section.storage, `${where}.storage`)
  if (section.types === undefined || section.types === null) return
  if (!isRecord(section.types)) throw new Error(`invalid layout: ${where}.types must be an object`)

  for (const [id, type] of Object.entries(section.types)) {
    const field = `${where}.types[${id}]`
    if (
      !isTypeId(id) ||
      !isRecord(type) ||
      typeof type.label !== 'string' ||
      type.label === '' ||
      !isDecimal(type.numberOfBytes, TYPE_BYTES_MAX_DECIMAL) ||
      type.numberOfBytes === '0' ||
      (type.encoding !== undefined && typeof type.encoding !== 'string')
    ) {
      throw new Error(`invalid layout: ${field} has invalid type fields`)
    }
    for (const ref of ['base', 'key', 'value']) {
      if (type[ref] !== undefined && !isTypeId(type[ref])) {
        throw new Error(`invalid layout: ${field}.${ref} must be a type identifier`)
      }
    }
    if (type.members !== undefined) {
      if (!Array.isArray(type.members)) {
        throw new Error(`invalid layout: ${field}.members must be an array`)
      }
      assertItems(type.members, `${field}.members`)
    }
  }
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
  const maxLines = 100
  const maxChars = 16 * 1024
  let chars = 0
  for (const line of diffLayoutLines(before, after)) {
    chars += line.length + 1
    if (lines.length === maxLines || chars > maxChars) {
      lines.push('Additional storage layout differences omitted.')
      break
    }
    lines.push(line)
  }
  return lines
}

function* diffLayoutLines(before: NormalizedLayout, after: NormalizedLayout): Generator<string> {
  yield* diffSection(before, after, '')
  const empty: NormalizedSection = {storage: [], types: {}}
  const locations = new Set([
    ...Object.keys(before.namespaces ?? {}),
    ...Object.keys(after.namespaces ?? {})
  ])
  for (const location of locations) {
    yield* diffSection(
      before.namespaces?.[location] ?? empty,
      after.namespaces?.[location] ?? empty,
      `${location} `
    )
  }
}

function storagePosition(item: NormalizedStorageItem): string {
  return `${item.slot}:${item.offset}`
}

function* diffSection(
  before: NormalizedSection,
  after: NormalizedSection,
  where: string
): Generator<string> {
  const location = (item: NormalizedStorageItem): string =>
    `${where}slot ${item.slot} offset ${item.offset}`

  const beforeByKey = new Map(before.storage.map(item => [storagePosition(item), item]))
  const afterByKey = new Map(after.storage.map(item => [storagePosition(item), item]))

  for (const [k, item] of beforeByKey) {
    const other = afterByKey.get(k)
    if (other === undefined) {
      yield `- ${item.label}: ${item.type} (${location(item)})`
    } else if (item.label !== other.label || item.type !== other.type) {
      yield `~ ${location(item)}: ${item.label} (${item.type}) -> ${other.label} (${other.type})`
    } else if (item.contract !== other.contract) {
      yield `~ ${item.label}: contract changed ${item.contract} -> ${other.contract}`
    }
  }
  for (const [k, item] of afterByKey) {
    if (!beforeByKey.has(k)) {
      yield `+ ${item.label}: ${item.type} (${location(item)})`
    }
  }

  const typeIds = new Set([...Object.keys(before.types), ...Object.keys(after.types)])
  for (const id of typeIds) {
    const beforeType = before.types[id]
    const afterType = after.types[id]
    if (beforeType === undefined) {
      yield `+ type ${where}${id}`
    } else if (afterType === undefined) {
      yield `- type ${where}${id}`
    } else if (!deepEqual(beforeType, afterType)) {
      yield `~ type ${where}${id}: definition changed`
    }
  }
}

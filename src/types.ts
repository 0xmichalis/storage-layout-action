/**
 * Shapes of the solc `storageLayout` output as emitted by
 * `forge inspect <contract> storage-layout --json`.
 */
export interface RawStorageItem {
  astId?: number
  contract?: string
  label: string
  offset: number
  slot: string
  type: string
}

export interface RawTypeMember {
  astId?: number
  contract?: string
  label: string
  offset: number
  slot: string
  type: string
}

export interface RawType {
  encoding?: string
  label?: string
  numberOfBytes?: string
  members?: RawTypeMember[]
  base?: string
  key?: string
  value?: string
}

export interface RawSection {
  storage: RawStorageItem[]
  types?: Record<string, RawType> | null
}

export interface RawLayout extends RawSection {
  /** Only in normalized snapshots; forge reports namespaced items in `storage`. */
  namespaces?: Record<string, RawSection>
}

/**
 * Normalized layout: only semantically relevant fields, with type
 * identifiers stabilized (astId noise stripped) so that unrelated
 * source changes do not affect comparisons.
 */
export interface NormalizedStorageItem {
  label: string
  offset: number
  slot: string
  type: string
  contract?: string
}

export interface NormalizedTypeMember {
  label: string
  offset: number
  slot: string
  type: string
}

export interface NormalizedType {
  encoding?: string
  label?: string
  numberOfBytes?: string
  members?: NormalizedTypeMember[]
  base?: string
  key?: string
  value?: string
}

export interface NormalizedSection {
  storage: NormalizedStorageItem[]
  types: Record<string, NormalizedType>
}

export interface NormalizedLayout extends NormalizedSection {
  /**
   * ERC-7201 namespaces keyed by storage location (`erc7201:<namespace id>`),
   * each with its own types, as forge scopes them. Omitted when the contract
   * has no namespaces.
   */
  namespaces?: Record<string, NormalizedSection>
}

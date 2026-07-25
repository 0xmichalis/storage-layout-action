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

export interface RawLayout {
  storage: RawStorageItem[]
  types?: Record<string, RawType> | null
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

export interface NormalizedLayout {
  storage: NormalizedStorageItem[]
  types: Record<string, NormalizedType>
}

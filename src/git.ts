import {run} from './run'

export interface GitContext {
  /** Absolute path of the repository root. */
  root: string
  /** Path of the working directory relative to the root ('' at the root). */
  prefix: string
}

export function gitContext(cwd: string): GitContext | undefined {
  const root = run('git', ['rev-parse', '--show-toplevel'], cwd)
  if (!root.ok) return undefined
  const prefix = run('git', ['rev-parse', '--show-prefix'], cwd)
  if (!prefix.ok) return undefined
  return {
    root: root.stdout.trim(),
    prefix: prefix.stdout.trim().replace(/\/$/, '')
  }
}

export interface BaseCandidate {
  ref: string
  description: string
}

export interface BaseSkip {
  reason: string
}

interface PickBaseOptions {
  baseInput: string
  eventName: string
  /** GITHUB_BASE_REF: target branch of a pull request. */
  baseRef: string
  eventPayload: Record<string, unknown>
}

/** Determines what to compare against, based on inputs and the triggering event. */
export function pickBaseCandidate(options: PickBaseOptions): BaseCandidate | BaseSkip {
  const {baseInput, eventName, baseRef, eventPayload} = options

  if (baseInput !== '') {
    return {ref: baseInput, description: '`base` input'}
  }

  if (eventName === 'pull_request' || eventName === 'pull_request_target') {
    if (baseRef !== '') {
      return {ref: baseRef, description: `pull request base branch '${baseRef}'`}
    }
    return {reason: 'GITHUB_BASE_REF is not set'}
  }

  if (eventName === 'push') {
    const before = eventPayload.before
    if (typeof before === 'string' && /^[0-9a-f]{40}$/.test(before) && !/^0+$/.test(before)) {
      return {ref: before, description: 'commit before the push'}
    }
    return {reason: 'push to a new branch has no previous commit to compare against'}
  }

  if (eventName === 'merge_group') {
    const mergeGroup = eventPayload.merge_group as Record<string, unknown> | undefined
    const baseSha = mergeGroup?.base_sha
    if (typeof baseSha === 'string' && baseSha !== '') {
      return {ref: baseSha, description: 'merge queue base'}
    }
    return {reason: 'merge_group event has no base_sha'}
  }

  return {
    reason: `event '${eventName || 'unknown'}' has no implicit base; set the \`base\` input to enable the compatibility check`
  }
}

export interface ResolvedBase {
  sha: string
  description: string
}

function revParse(cwd: string, ref: string): string | undefined {
  const result = run('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd)
  return result.ok ? result.stdout.trim() : undefined
}

/**
 * Resolves a candidate ref or commit hash to a commit sha, fetching from
 * `origin` when it is not available locally (checkouts are shallow on CI).
 */
export function resolveBaseCommit(cwd: string, candidate: BaseCandidate): ResolvedBase | BaseSkip {
  const {ref, description} = candidate
  if (ref.startsWith('-') || /\s/.test(ref)) {
    return {reason: `invalid base ref '${ref}'`}
  }

  if (/^[0-9a-f]{7,40}$/i.test(ref)) {
    const sha = revParse(cwd, ref)
    if (sha !== undefined) return {sha, description}
  }

  const fetched = run(
    'git',
    ['fetch', '--no-tags', '--no-recurse-submodules', '--depth=1', 'origin', ref],
    cwd
  )
  if (fetched.ok) {
    const sha = revParse(cwd, 'FETCH_HEAD')
    if (sha !== undefined) return {sha, description: `${description}, fetched from origin`}
  }

  const sha = revParse(cwd, ref)
  if (sha !== undefined) return {sha, description}

  return {reason: `could not resolve '${ref}' (${description}) to a commit`}
}

/** Content of a file at a given commit, or undefined if it does not exist there. */
export function fileAtCommit(cwd: string, sha: string, repoRelPath: string): string | undefined {
  const result = run('git', ['show', `${sha}:${repoRelPath}`], cwd)
  return result.ok ? result.stdout : undefined
}

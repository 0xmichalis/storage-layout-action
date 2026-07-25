import * as fs from 'fs'
import * as path from 'path'

import {checkCompatibility} from './compare'
import {ContractSpec, resolveContractSet} from './contracts'
import {forgeVersion, inspectLayout} from './forge'
import * as gha from './gha'
import {fileAtCommit, gitContext, pickBaseCandidate, resolveBaseCommit, ResolvedBase} from './git'
import {deepEqual, diffLayouts, normalizeLayout, parseLayout} from './layout'
import {NormalizedLayout} from './types'

type Freshness = 'ok' | 'stale' | 'missing' | 'error'
type Compatibility = 'ok' | 'incompatible' | 'new-contract' | 'skipped' | 'error'

interface ContractOutcome {
  spec: ContractSpec
  freshness: Freshness
  freshnessDetail: string
  compatibility: Compatibility
  compatibilityDetail: string
}

interface CheckContext {
  workingDirectory: string
  snapshotDir: string
  /** Snapshot dir relative to the working directory, for shell instructions. */
  snapshotDirFromWd: string
  /** Snapshot dir relative to the repo root, for `git show` and annotations. */
  snapshotDirFromRoot?: string
  base?: ResolvedBase
  baseSkipReason?: string
  unsafeAllowRenames: boolean
}

const toPosix = (value: string): string => value.split(path.sep).join('/')

function regenCommand(context: CheckContext, spec: ContractSpec): string {
  return `forge inspect ${spec.target} storage-layout --json > ${path.posix.join(
    context.snapshotDirFromWd,
    `${spec.name}.json`
  )}`
}

function checkContract(context: CheckContext, spec: ContractSpec): ContractOutcome {
  const outcome: ContractOutcome = {
    spec,
    freshness: 'ok',
    freshnessDetail: '',
    compatibility: 'skipped',
    compatibilityDetail: ''
  }

  let current: NormalizedLayout
  try {
    current = normalizeLayout(inspectLayout(spec.target, context.workingDirectory))
  } catch (error) {
    outcome.freshness = 'error'
    outcome.freshnessDetail = error instanceof Error ? error.message : String(error)
    outcome.compatibilityDetail = 'skipped: could not extract the current storage layout'
    return outcome
  }

  const snapshotFile = path.join(context.snapshotDir, `${spec.name}.json`)
  if (!fs.existsSync(snapshotFile)) {
    outcome.freshness = 'missing'
    outcome.freshnessDetail = `No snapshot found for ${spec.name}. Create one and commit it:\n  ${regenCommand(context, spec)}`
  } else {
    try {
      const snapshot = normalizeLayout(parseLayout(fs.readFileSync(snapshotFile, 'utf8')))
      if (!deepEqual(snapshot, current)) {
        outcome.freshness = 'stale'
        outcome.freshnessDetail = `The committed snapshot no longer matches the storage layout of ${spec.name}:\n${diffLayouts(
          snapshot,
          current
        )
          .map(line => `  ${line}`)
          .join('\n')}\nRegenerate it and commit the result:\n  ${regenCommand(context, spec)}`
      }
    } catch (error) {
      outcome.freshness = 'error'
      outcome.freshnessDetail = `Could not read the committed snapshot (${
        error instanceof Error ? error.message : String(error)
      }). Regenerate it:\n  ${regenCommand(context, spec)}`
    }
  }

  if (context.base === undefined || context.snapshotDirFromRoot === undefined) {
    outcome.compatibilityDetail = `skipped: ${context.baseSkipReason ?? 'no base to compare against'}`
    return outcome
  }

  const baseSnapshotPath = path.posix.join(context.snapshotDirFromRoot, `${spec.name}.json`)
  const baseContent = fileAtCommit(context.workingDirectory, context.base.sha, baseSnapshotPath)
  if (baseContent === undefined) {
    outcome.compatibility = 'new-contract'
    outcome.compatibilityDetail = `no snapshot at ${context.base.sha.slice(0, 12)}; nothing to compare against`
    return outcome
  }

  let baseLayout: NormalizedLayout
  try {
    baseLayout = normalizeLayout(parseLayout(baseContent))
  } catch (error) {
    outcome.compatibility = 'error'
    outcome.compatibilityDetail = `snapshot at ${context.base.sha.slice(0, 12)} is invalid: ${
      error instanceof Error ? error.message : String(error)
    }`
    return outcome
  }

  const result = checkCompatibility(baseLayout, current, context.unsafeAllowRenames)
  if (result.pass) {
    outcome.compatibility = 'ok'
  } else {
    outcome.compatibility = 'incompatible'
    outcome.compatibilityDetail = result.explanation
  }
  return outcome
}

const FRESHNESS_LABELS: Record<Freshness, string> = {
  ok: '✅ up to date',
  stale: '❌ stale',
  missing: '❌ missing',
  error: '❌ error'
}

const COMPATIBILITY_LABELS: Record<Compatibility, string> = {
  ok: '✅ compatible',
  incompatible: '❌ incompatible',
  'new-contract': '➕ new contract',
  skipped: '⏭️ skipped',
  error: '❌ error'
}

function reportOutcomes(context: CheckContext, outcomes: ContractOutcome[]): boolean {
  const summary: string[] = ['## Storage layout check', '']
  summary.push(
    context.base !== undefined
      ? `Compatibility base: \`${context.base.sha}\` (${context.base.description})`
      : `Compatibility check skipped: ${context.baseSkipReason ?? 'no base to compare against'}`
  )
  summary.push('', '| Contract | Snapshot | Compatibility |', '| --- | --- | --- |')

  let failed = false
  for (const outcome of outcomes) {
    const annotationFile =
      context.snapshotDirFromRoot === undefined
        ? undefined
        : path.posix.join(context.snapshotDirFromRoot, `${outcome.spec.name}.json`)

    if (outcome.freshness !== 'ok') {
      failed = true
      gha.error(outcome.freshnessDetail, {
        file: annotationFile,
        title: `${outcome.spec.name}: storage layout snapshot ${outcome.freshness === 'stale' ? 'is stale' : outcome.freshness === 'missing' ? 'is missing' : 'check errored'}`
      })
    }
    if (outcome.compatibility === 'incompatible' || outcome.compatibility === 'error') {
      failed = true
      gha.error(outcome.compatibilityDetail, {
        file: annotationFile,
        title: `${outcome.spec.name}: incompatible storage layout change`
      })
    }

    summary.push(
      `| ${outcome.spec.name} | ${FRESHNESS_LABELS[outcome.freshness]} | ${COMPATIBILITY_LABELS[outcome.compatibility]} |`
    )
  }

  for (const outcome of outcomes) {
    const details: string[] = []
    if (outcome.freshness !== 'ok') details.push(outcome.freshnessDetail)
    if (outcome.compatibility === 'incompatible' || outcome.compatibility === 'error') {
      details.push(outcome.compatibilityDetail)
    }
    if (details.length > 0) {
      summary.push(
        '',
        `<details><summary>${outcome.spec.name}</summary>`,
        '',
        '```',
        details.join('\n\n'),
        '```',
        '',
        '</details>'
      )
    }
  }

  gha.appendSummary(`${summary.join('\n')}\n`)
  return failed
}

function fail(message: string): void {
  gha.error(message)
  process.exitCode = 1
}

export function main(): void {
  const contractsInput = gha.getInput('contracts')
  const snapshotDirInput = gha.getInput('storage-layout-path', 'storage-layouts')
  const workingDirectoryInput = gha.getInput('working-directory', '.')
  const baseInput = gha.getInput('base')
  const unsafeAllowRenames = gha.getBooleanInput('unsafe-allow-renames', false)

  const workingDirectory = path.resolve(process.cwd(), workingDirectoryInput)
  if (!fs.existsSync(path.join(workingDirectory, 'foundry.toml'))) {
    fail(
      `No foundry.toml found in '${workingDirectory}'. Point \`working-directory\` at the root of a Foundry project.`
    )
    return
  }

  const version = forgeVersion(workingDirectory)
  if (version === undefined) {
    fail('forge is not available on PATH. Install Foundry, e.g. with foundry-rs/foundry-toolchain.')
    return
  }
  gha.info(`Using ${version}`)

  const snapshotDir = path.resolve(workingDirectory, snapshotDirInput)
  let specs: ContractSpec[]
  try {
    specs = resolveContractSet(contractsInput, snapshotDir)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
    return
  }
  if (specs.length === 0) {
    fail(
      `No contracts to check: the \`contracts\` input is empty and '${toPosix(
        path.relative(workingDirectory, snapshotDir)
      )}' contains no snapshots. Bootstrap the snapshots (once per contract) with:\n` +
        `  mkdir -p ${toPosix(path.relative(workingDirectory, snapshotDir))}\n` +
        `  forge inspect <Contract> storage-layout --json > ${toPosix(
          path.relative(workingDirectory, snapshotDir)
        )}/<Contract>.json\n` +
        `and commit the results, or set the \`contracts\` input.`
    )
    return
  }

  const context: CheckContext = {
    workingDirectory,
    snapshotDir,
    snapshotDirFromWd: toPosix(path.relative(workingDirectory, snapshotDir)) || '.',
    unsafeAllowRenames
  }

  const git = gitContext(workingDirectory)
  if (git === undefined) {
    context.baseSkipReason = 'not inside a git repository'
  } else {
    const fromRoot = path.relative(git.root, snapshotDir)
    if (fromRoot.startsWith('..')) {
      context.baseSkipReason = `snapshot directory '${snapshotDir}' is outside the git repository`
    } else {
      context.snapshotDirFromRoot = toPosix(fromRoot)
      const candidate = pickBaseCandidate({
        baseInput,
        eventName: process.env.GITHUB_EVENT_NAME ?? '',
        baseRef: process.env.GITHUB_BASE_REF ?? '',
        eventPayload: readEventPayload()
      })
      if ('reason' in candidate) {
        context.baseSkipReason = candidate.reason
      } else {
        const resolved = resolveBaseCommit(workingDirectory, candidate)
        if ('reason' in resolved) {
          context.baseSkipReason = resolved.reason
        } else {
          context.base = resolved
        }
      }
    }
  }

  if (context.base !== undefined) {
    gha.info(`Comparing against ${context.base.sha} (${context.base.description})`)
  } else {
    gha.notice(`Compatibility check skipped: ${context.baseSkipReason}`)
  }

  const outcomes: ContractOutcome[] = []
  for (const spec of specs) {
    gha.startGroup(`Checking ${spec.name}`)
    const outcome = checkContract(context, spec)
    gha.info(`snapshot: ${outcome.freshness}`)
    if (outcome.freshnessDetail !== '') gha.info(outcome.freshnessDetail)
    gha.info(`compatibility: ${outcome.compatibility}`)
    if (outcome.compatibilityDetail !== '') gha.info(outcome.compatibilityDetail)
    gha.endGroup()
    outcomes.push(outcome)
  }

  if (reportOutcomes(context, outcomes)) {
    process.exitCode = 1
    gha.info('Storage layout check failed.')
  } else {
    gha.info(`Storage layout check passed for ${outcomes.length} contract(s).`)
  }
}

function readEventPayload(): Record<string, unknown> {
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (eventPath === undefined || eventPath === '' || !fs.existsSync(eventPath)) return {}
  try {
    return JSON.parse(fs.readFileSync(eventPath, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

main()

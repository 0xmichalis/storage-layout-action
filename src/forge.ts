import {RawLayout} from './types'
import {parseLayout} from './layout'
import {run, tail} from './run'

export function forgeVersion(cwd: string): string | undefined {
  const result = run('forge', ['--version'], cwd)
  return result.ok ? result.stdout.trim().split('\n')[0] : undefined
}

/**
 * Extracts the storage layout of a contract. Triggers a project build on
 * the first invocation.
 */
export function inspectLayout(target: string, cwd: string): RawLayout {
  const result = run('forge', ['inspect', target, 'storage-layout', '--json'], cwd)
  if (!result.ok) {
    throw new Error(`\`forge inspect ${target} storage-layout\` failed:\n${tail(result.stderr)}`)
  }
  try {
    return parseLayout(result.stdout)
  } catch (error) {
    throw new Error(
      `unexpected \`forge inspect ${target} storage-layout --json\` output (${
        error instanceof Error ? error.message : String(error)
      })`
    )
  }
}

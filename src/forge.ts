import {RawLayout} from './types'
import {parseLayout} from './layout'
import {run, tail} from './run'

export function forgeVersion(cwd: string): string | undefined {
  const result = run('forge', ['--version'], cwd)
  return result.ok ? result.stdout.trim().split('\n')[0] : undefined
}

/** Project paths from `forge config`, as configured (relative or absolute). */
export interface ForgeConfig {
  src: string
  out: string
  cachePath: string
  cache: boolean
}

export function forgeConfig(cwd: string): ForgeConfig {
  const result = run('forge', ['config', '--json'], cwd)
  if (!result.ok) {
    throw new Error(`\`forge config --json\` failed:\n${tail(result.stderr)}`)
  }
  let config: Record<string, unknown>
  try {
    config = JSON.parse(result.stdout) as Record<string, unknown>
  } catch (error) {
    throw new Error(
      `unexpected \`forge config --json\` output (${
        error instanceof Error ? error.message : String(error)
      })`
    )
  }
  const field = (key: string): string => {
    const value = config[key]
    if (typeof value !== 'string' || value === '') {
      throw new Error(`\`forge config --json\` has no \`${key}\``)
    }
    return value
  }
  return {
    src: field('src'),
    out: field('out'),
    cachePath: field('cache_path'),
    cache: config.cache !== false
  }
}

/**
 * Builds the project with the AST in the artifacts. Also requests the
 * storage layout like `forge inspect` does: forge treats artifacts built
 * without an output as fresh, so a later `forge inspect <contract>
 * storage-layout` fails on them. The AST has the same caveat, so `force` is
 * there to rebuild when an artifact still lacks it.
 */
export function forgeBuild(cwd: string, force = false): void {
  const args = ['build', '--ast', '--extra-output', 'storageLayout']
  if (force) args.push('--force')
  const result = run('forge', args, cwd)
  if (!result.ok) {
    throw new Error(`\`forge build\` failed:\n${tail(`${result.stdout}\n${result.stderr}`)}`)
  }
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

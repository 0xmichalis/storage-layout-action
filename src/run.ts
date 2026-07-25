import {spawnSync} from 'child_process'

export interface RunResult {
  ok: boolean
  stdout: string
  stderr: string
}

/** Runs a command without a shell; never throws. */
export function run(command: string, args: string[], cwd: string): RunResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  return {
    ok: result.status === 0 && result.error === undefined,
    stdout: result.stdout ?? '',
    stderr: result.error !== undefined ? String(result.error) : (result.stderr ?? '')
  }
}

/** Last `maxLines` non-empty lines of a stream, for error reporting. */
export function tail(output: string, maxLines = 20): string {
  const lines = output.split('\n').filter(line => line.trim() !== '')
  return lines.slice(-maxLines).join('\n')
}

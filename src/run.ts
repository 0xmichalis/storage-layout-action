import {spawnSync} from 'child_process'

export const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024 * 1024

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
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES
  })
  return {
    ok: result.status === 0 && result.error === undefined,
    stdout: result.stdout ?? '',
    stderr: result.error !== undefined ? String(result.error) : (result.stderr ?? '')
  }
}

/** Bounds command diagnostics to 20 lines and 16,384 UTF-16 code units. */
export function tail(output: string): string {
  const maxChars = 16 * 1024
  const lines = output
    .slice(-maxChars)
    .split('\n')
    .filter(line => line.trim() !== '')
  return lines.slice(-20).join('\n')
}

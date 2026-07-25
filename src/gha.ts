import * as fs from 'fs'

/** Minimal GitHub Actions workflow-command helpers. */

function escapeData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C')
}

interface AnnotationProperties {
  title?: string
  file?: string
}

function issue(command: string, message: string, properties: AnnotationProperties = {}): void {
  const props = Object.entries(properties)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${escapeProperty(value as string)}`)
    .join(',')
  process.stdout.write(`::${command}${props ? ` ${props}` : ''}::${escapeData(message)}\n`)
}

export function error(message: string, properties?: AnnotationProperties): void {
  issue('error', message, properties)
}

export function warning(message: string, properties?: AnnotationProperties): void {
  issue('warning', message, properties)
}

export function notice(message: string, properties?: AnnotationProperties): void {
  issue('notice', message, properties)
}

export function startGroup(name: string): void {
  process.stdout.write(`::group::${escapeData(name)}\n`)
}

export function endGroup(): void {
  process.stdout.write('::endgroup::\n')
}

export function info(message: string): void {
  process.stdout.write(`${message}\n`)
}

export function appendSummary(markdown: string): void {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY
  if (summaryFile === undefined || summaryFile === '') return
  fs.appendFileSync(summaryFile, markdown)
}

export function getInput(name: string, defaultValue = ''): string {
  const key = `INPUT_${name.replace(/-/g, '_').toUpperCase()}`
  const value = process.env[key]
  return value === undefined || value === '' ? defaultValue : value.trim()
}

export function getBooleanInput(name: string, defaultValue: boolean): boolean {
  const value = getInput(name)
  if (value === '') return defaultValue
  if (/^true$/i.test(value)) return true
  if (/^false$/i.test(value)) return false
  throw new Error(`input \`${name}\` must be 'true' or 'false', got '${value}'`)
}

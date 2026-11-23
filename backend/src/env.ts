// Loads the repo-root .env and gives typed, never-logged access to secrets.
import { config } from 'dotenv'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BACKEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const REPO_ROOT = resolve(BACKEND_DIR, '..')
export const ENV_PATH = resolve(REPO_ROOT, '.env')

let loaded = false

export function loadEnv(): void {
  if (loaded) return
  // A missing .env is not fatal here: requireEnv() names the variable that is missing.
  if (existsSync(ENV_PATH)) config({ path: ENV_PATH, quiet: true })
  loaded = true
}

/** Returns a required variable. The error names the variable, never its value. */
export function requireEnv(name: string): string {
  loadEnv()
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set. Fill it in ${ENV_PATH} (copy .env.example to .env first).`)
  return value
}

export function optionalEnv(name: string): string | undefined {
  loadEnv()
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

/**
 * Sets KEY=value in the repo-root .env in place (replaces an existing line or appends one).
 * Used by the Telegram login script so the session string goes straight to disk and is never printed.
 */
export function writeEnvValue(name: string, value: string): void {
  if (!/^[A-Z0-9_]+$/.test(name)) throw new Error('invalid env var name')
  if (/[\r\n]/.test(value)) throw new Error('env value must be a single line')
  const original = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : ''
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  const lines = original.length ? original.split(/\r?\n/) : []
  const line = `${name}=${value}`
  const idx = lines.findIndex((l) => l.startsWith(`${name}=`))
  if (idx >= 0) {
    lines[idx] = line
  } else {
    if (lines.length && lines[lines.length - 1] === '') lines.pop()
    lines.push(line, '')
  }
  writeFileSync(ENV_PATH, lines.join(eol), { encoding: 'utf8', mode: 0o600 })
  process.env[name] = value
}

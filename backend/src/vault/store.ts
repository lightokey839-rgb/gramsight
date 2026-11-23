// The address vault: the owner's PUBLIC addresses, each labelled by chain and a short name ("Solana main").
// Stored as JSON outside the repo (default ~/.gramsight/vault.json). Never holds keys or seed phrases.
// Also remembers which Telegram users have started the vault bot (needed for the Bot API wallet-card fallback).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { optionalEnv } from '../env.ts'
import { type Chain, chainDisplay, validateForChain } from './addresses.ts'

export type VaultEntry = {
  chain: Chain
  name: string
  /** As shown to people (EVM in checksum form, TON as given). */
  address: string
  /** Comparison form (TON raw workchain:hash, EVM lowercase hex, ...). */
  normalized: string
  addedAt: string
  updatedAt: string
}

export type Starter = { firstSeen: string; username?: string }

type VaultFile = { version: 1; entries: VaultEntry[]; starters: Record<string, Starter> }

export function dataDir(): string {
  return resolve(optionalEnv('GRAMSIGHT_DATA_DIR') ?? join(homedir(), '.gramsight'))
}

export function defaultVaultPath(): string {
  return join(dataDir(), 'vault.json')
}

/** "main", "savings", "cold-2": lowercase letters, digits, - and _, up to 20 characters. */
export function normalizeName(name: string): string | undefined {
  const n = name.trim().toLowerCase()
  return /^[a-z0-9][a-z0-9_-]{0,19}$/.test(n) ? n : undefined
}

export function entryLabel(e: { chain: Chain; name: string }): string {
  return `${chainDisplay(e.chain)} ${e.name}`
}

export class VaultStore {
  constructor(readonly path: string = defaultVaultPath()) {}

  private read(): VaultFile {
    if (!existsSync(this.path)) return { version: 1, entries: [], starters: {} }
    const data = JSON.parse(readFileSync(this.path, 'utf8')) as VaultFile
    if (data.version !== 1 || !Array.isArray(data.entries)) throw new Error(`Unrecognised vault file: ${this.path}`)
    data.starters ??= {}
    return data
  }

  /** Atomic write: a crash mid-write never leaves a half-written vault. */
  private write(data: VaultFile): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, this.path)
  }

  list(): VaultEntry[] {
    return [...this.read().entries].sort((a, b) => entryLabel(a).localeCompare(entryLabel(b)))
  }

  get(chain: Chain, name: string): VaultEntry | undefined {
    const n = normalizeName(name)
    return this.read().entries.find((e) => e.chain === chain && e.name === n)
  }

  byChain(chain: Chain): VaultEntry[] {
    return this.read().entries.filter((e) => e.chain === chain)
  }

  /** Adds or replaces a labelled address. Throws with a readable reason if the address is not valid for the chain. */
  upsert(chain: Chain, name: string, address: string, now = new Date()): { entry: VaultEntry; previous?: VaultEntry } {
    const n = normalizeName(name)
    if (!n) throw new Error('Name must be 1 to 20 characters: letters, digits, - or _ (for example "main")')
    const checked = validateForChain(chain, address)
    if (!checked.ok) throw new Error(`Not a valid ${chainDisplay(chain)} address: ${checked.reason}`)
    const data = this.read()
    const idx = data.entries.findIndex((e) => e.chain === chain && e.name === n)
    const previous = idx >= 0 ? data.entries[idx] : undefined
    const stamp = now.toISOString()
    const entry: VaultEntry = {
      chain,
      name: n,
      address: checked.display,
      normalized: checked.normalized,
      addedAt: previous?.addedAt ?? stamp,
      updatedAt: stamp,
    }
    if (idx >= 0) data.entries[idx] = entry
    else data.entries.push(entry)
    this.write(data)
    return { entry, previous }
  }

  remove(chain: Chain, name: string): VaultEntry | undefined {
    const n = normalizeName(name)
    const data = this.read()
    const idx = data.entries.findIndex((e) => e.chain === chain && e.name === n)
    if (idx < 0) return undefined
    const [removed] = data.entries.splice(idx, 1)
    this.write(data)
    return removed
  }

  recordStarter(userId: number, username?: string, now = new Date()): boolean {
    const data = this.read()
    const key = String(userId)
    if (data.starters[key]) return false
    data.starters[key] = { firstSeen: now.toISOString(), ...(username ? { username } : {}) }
    this.write(data)
    return true
  }

  starters(): Record<string, Starter> {
    return { ...this.read().starters }
  }
}

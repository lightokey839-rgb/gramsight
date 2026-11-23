// Telegram user-account client on TDLib (tdl + prebuilt-tdlib 1.8.70).
// TDLib is used because it is on a layer that has the TON wallet card (userFullInfo.ton_wallet_card)
// and the address -> owner lookup (getAddressTonWallet); GramJS and mtcute are not.
//
// The login lives in TDLib's own database folder, encrypted with TELEGRAM_TDLIB_DB_KEY from .env.
// The folder defaults to ~/.gramsight/tdlib, outside the repo. Nothing secret is ever logged.
import * as tdl from 'tdl'
import type { Client } from 'tdl'
import { getTdjson } from 'prebuilt-tdlib'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { optionalEnv, requireEnv } from './env.ts'

export type { Client }

let configured = false

/** Points tdl at the bundled tdjson library. Safe to call more than once. */
export function configureTdlib(): void {
  if (configured) return
  tdl.configure({ tdjson: getTdjson(), verbosityLevel: 1 })
  configured = true
}

export function apiCredentials(): { apiId: number; apiHash: string } {
  const apiId = Number(requireEnv('TELEGRAM_API_ID'))
  if (!Number.isInteger(apiId) || apiId <= 0) throw new Error('TELEGRAM_API_ID must be a number')
  return { apiId, apiHash: requireEnv('TELEGRAM_API_HASH') }
}

/** TDLib's data folder (login database and downloaded files). Outside the repo by default. */
export function tdlibDir(): string {
  return resolve(optionalEnv('TELEGRAM_TDLIB_DIR') ?? join(homedir(), '.gramsight', 'tdlib'))
}

/** Creates a TDLib client for the user account. Does not log in by itself. */
export function createUserClient(): Client {
  configureTdlib()
  const { apiId, apiHash } = apiCredentials()
  const dir = tdlibDir()
  mkdirSync(dir, { recursive: true })
  return tdl.createClient({
    apiId,
    apiHash,
    databaseDirectory: join(dir, 'db'),
    filesDirectory: join(dir, 'files'),
    databaseEncryptionKey: requireEnv('TELEGRAM_TDLIB_DB_KEY'),
    tdlibParameters: {
      use_message_database: true,
      use_secret_chats: false,
      system_language_code: 'en',
      application_version: '0.1.0',
      device_model: 'Gramsight backend',
      system_version: process.platform,
    },
  })
}

/**
 * Creates a client and waits until it is logged in, without ever prompting.
 * Throws if the account is not logged in yet: run `npm run telegram:login` in your own terminal first.
 */
export async function connectLoggedIn(): Promise<Client> {
  const client = createUserClient()
  try {
    await client.login(() => {
      throw new Error('Telegram user account is not logged in. Run `npm run telegram:login` in your own terminal first.')
    })
  } catch (err) {
    await closeClient(client)
    throw err
  }
  return client
}

export async function closeClient(client: Client): Promise<void> {
  try {
    if (!client.isClosed()) await client.close()
  } catch {
    // closing is best effort
  }
}

/** Reads a boolean TDLib option such as can_use_ton_wallet. Returns undefined if TDLib has no value for it. */
export async function getBooleanOption(client: Client, name: string): Promise<boolean | undefined> {
  const v = await client.invoke({ _: 'getOption', name })
  return v._ === 'optionValueBoolean' ? v.value : undefined
}

/** Resolves "me", "@username" or a numeric user id to a TDLib user id. */
export async function resolveUserId(client: Client, target: string): Promise<number> {
  if (target === 'me') return (await client.invoke({ _: 'getMe' })).id
  if (/^\d+$/.test(target)) {
    const user = await client.invoke({ _: 'getUser', user_id: Number(target) })
    return user.id
  }
  const chat = await client.invoke({ _: 'searchPublicChat', username: target.replace(/^@/, '') })
  if (chat.type._ !== 'chatTypePrivate') throw new Error(`${target} is not a user (it is a ${chat.type._})`)
  return chat.type.user_id
}

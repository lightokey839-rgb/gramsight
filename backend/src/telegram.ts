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
  tdl.configure({ tdjson: getTdjson(), verbosityLevel: 0 }) // 0 = fatal only; request errors still surface as TDLibError
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

/**
 * Sends one plain-text message as the logged-in user and waits until Telegram confirms it.
 * Returns the final message id. Never retries: on a timeout the caller must check the chat before trying again,
 * so a slow network can never turn into a double send. The text is sent verbatim (no markdown parsing).
 */
export async function sendTextAsUser(client: Client, chatId: number, text: string, timeoutMs = 20_000): Promise<number> {
  if (!text.trim()) throw new Error('Refusing to send an empty message')
  // Collect send results from the moment we start, so a fast confirmation cannot be missed.
  const results = new Map<number, { ok: true; id: number } | { ok: false; reason: string }>()
  let waiting: { tempId: number; resolve: (id: number) => void; reject: (e: Error) => void } | undefined
  const onUpdate = (u: { _: string } & Record<string, unknown>) => {
    if (u._ !== 'updateMessageSendSucceeded' && u._ !== 'updateMessageSendFailed') return
    const old = u.old_message_id as number
    const r =
      u._ === 'updateMessageSendSucceeded'
        ? ({ ok: true, id: (u.message as { id: number }).id } as const)
        : ({ ok: false, reason: (u.error as { message: string }).message } as const)
    if (waiting && waiting.tempId === old) {
      if (r.ok) waiting.resolve(r.id)
      else waiting.reject(new Error(`Telegram refused the message: ${r.reason}`))
    } else results.set(old, r)
  }
  client.on('update', onUpdate)
  try {
    const temp = await client.invoke({
      _: 'sendMessage',
      chat_id: chatId,
      input_message_content: { _: 'inputMessageText', text: { _: 'formattedText', text, entities: [] } },
    })
    const early = results.get(temp.id)
    if (early) {
      if (early.ok) return early.id
      throw new Error(`Telegram refused the message: ${early.reason}`)
    }
    return await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Not confirmed within ${timeoutMs / 1000} s. Check the chat before sending again.`)),
        timeoutMs,
      )
      waiting = {
        tempId: temp.id,
        resolve: (id) => (clearTimeout(timer), resolve(id)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      }
    })
  } finally {
    client.off('update', onUpdate)
  }
}

/** Resolves "me", "@username" or a numeric chat id to a TDLib chat id (loads the chat so it can be used). */
export async function resolveChatId(client: Client, target: string): Promise<number> {
  if (target === 'me') {
    const me = await client.invoke({ _: 'getMe' })
    return (await client.invoke({ _: 'createPrivateChat', user_id: me.id, force: false })).id
  }
  if (/^-?\d+$/.test(target)) return (await client.invoke({ _: 'getChat', chat_id: Number(target) })).id
  return (await client.invoke({ _: 'searchPublicChat', username: target.replace(/^@/, '') })).id
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

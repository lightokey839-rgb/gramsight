// GramJS (MTProto) user-account client built from .env. The session string is never logged.
import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { Logger, LogLevel } from 'telegram/extensions/Logger.js'
import { optionalEnv, requireEnv } from './env.ts'

export function apiCredentials(): { apiId: number; apiHash: string } {
  const apiId = Number(requireEnv('TELEGRAM_API_ID'))
  if (!Number.isInteger(apiId) || apiId <= 0) throw new Error('TELEGRAM_API_ID must be a number')
  return { apiId, apiHash: requireEnv('TELEGRAM_API_HASH') }
}

export function newClient(sessionString = ''): TelegramClient {
  const { apiId, apiHash } = apiCredentials()
  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 5,
    baseLogger: new Logger(LogLevel.ERROR),
    deviceModel: 'SafeGlance backend',
    appVersion: '0.1.0',
  })
  client.setLogLevel(LogLevel.ERROR)
  return client
}

/** Connects with TELEGRAM_SESSION from .env. Never prompts: run `npm run telegram:login` first. */
export async function connectFromEnv(): Promise<TelegramClient> {
  const session = optionalEnv('TELEGRAM_SESSION')
  if (!session) throw new Error('TELEGRAM_SESSION is empty. Run `npm run telegram:login` in your own terminal first.')
  const client = newClient(session)
  await client.connect()
  if (!(await client.checkAuthorization())) {
    throw new Error('TELEGRAM_SESSION is not authorized (logged out or revoked). Run `npm run telegram:login` again.')
  }
  return client
}

/** Closes the client and its update loop so the script can exit. */
export async function closeClient(client: TelegramClient): Promise<void> {
  try {
    await client.destroy()
  } catch {
    // ignore: closing is best effort
  }
}

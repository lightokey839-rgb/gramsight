// Logs the Telegram user account in with TDLib. Run it yourself in your own terminal:
//   npm run telegram:login              log in (you type the phone number, the login code and the 2FA password)
//   npm run telegram:login -- --logout  log this backend out (ends the "Gramsight backend" session)
// The login is stored in TDLib's encrypted database folder (default ~/.gramsight/tdlib, outside the repo).
// Its key, TELEGRAM_TDLIB_DB_KEY, is generated into .env on first run. Nothing secret is printed.
import { randomBytes } from 'node:crypto'
import * as readline from 'node:readline'
import { stdin, stdout } from 'node:process'
import { ENV_PATH, optionalEnv, setEnvIfEmpty, writeEnvValue } from '../src/env.ts'
import { closeClient, createUserClient, getBooleanOption, tdlibDir } from '../src/telegram.ts'

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

/** Like ask(), but does not echo what you type (for the 2FA password). */
function askHidden(question: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true })
  const r = rl as unknown as { _writeToOutput: (s: string) => void }
  let prompted = false
  r._writeToOutput = (s: string) => {
    if (!prompted) {
      stdout.write(s)
      prompted = true
    }
  }
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      stdout.write('\n')
      resolve(answer)
    })
  })
}

async function main(): Promise<void> {
  if (setEnvIfEmpty('TELEGRAM_TDLIB_DB_KEY', randomBytes(32).toString('base64'))) {
    console.log(`Generated TELEGRAM_TDLIB_DB_KEY (database encryption key) in ${ENV_PATH} (not shown).`)
  }
  if (optionalEnv('TELEGRAM_SESSION')) {
    console.log('Note: TELEGRAM_SESSION in .env is no longer used (Gramsight moved from GramJS to TDLib). You can delete that line.')
  }

  const client = createUserClient()
  try {
    if (process.argv.includes('--logout')) {
      await client.login(() => {
        throw new Error('Not logged in, nothing to log out.')
      })
      await client.invoke({ _: 'logOut' })
      console.log('Logged out. The "Gramsight backend" session is ended.')
      return
    }

    console.log('Gramsight: Telegram user-account login (TDLib).')
    console.log('Use your own established account. If this backend is already logged in, nothing is asked.\n')

    await client.login(() => ({
      type: 'user',
      getPhoneNumber: (retry?: boolean) =>
        ask(`${retry ? 'That did not work. ' : ''}Phone number, international format (e.g. +9715...): `),
      getAuthCode: (retry?: boolean) => ask(`${retry ? 'Wrong code. ' : ''}Login code Telegram just sent you: `),
      getPassword: (hint: string, retry?: boolean) =>
        askHidden(`${retry ? 'Wrong password. ' : ''}2FA password${hint ? ` (hint: ${hint})` : ''}: `),
      getEmailAddress: () => ask('Telegram asks for a login email address: '),
      getEmailCode: () => ask('Code Telegram sent to that email: '),
      confirmOnAnotherDevice: () => {
        console.log('Telegram asks you to confirm this login on another device. Open Telegram there and confirm.')
      },
      getName: () => Promise.reject(new Error('This phone number has no Telegram account. Use your existing account.')),
    }))

    const me = await client.invoke({ _: 'getMe' })
    const myId = String(me.id)
    const username = me.usernames?.active_usernames?.[0]
    console.log(`\nLogged in as user id ${myId}${username ? ` (@${username})` : ''}.`)
    console.log(`Login stored in ${tdlibDir()} (encrypted with TELEGRAM_TDLIB_DB_KEY). Keep that folder and .env private.`)
    console.log('To revoke it: Telegram > Settings > Devices > "Gramsight backend" > Terminate, or run with --logout.')

    const owner = optionalEnv('BOT_OWNER_TELEGRAM_ID')
    if (!owner) {
      writeEnvValue('BOT_OWNER_TELEGRAM_ID', myId)
      console.log(`BOT_OWNER_TELEGRAM_ID was empty: set it to your id ${myId} (the only account allowed to use the vault).`)
    } else if (owner !== myId) {
      console.log(`Note: BOT_OWNER_TELEGRAM_ID is ${owner}, but you logged in as ${myId}. Left unchanged; fix it if that is wrong.`)
    }

    const canUseWallet = await getBooleanOption(client, 'can_use_ton_wallet')
    console.log(`TDLib option can_use_ton_wallet: ${canUseWallet === undefined ? 'not set' : canUseWallet}`)
  } finally {
    await closeClient(client)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(`telegram:login failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })

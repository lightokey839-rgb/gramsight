// Logs the Telegram user account in with GramJS and writes the session string straight into .env.
// Run it yourself in your own terminal:  npm run telegram:login
// You type the phone number, the login code and the 2FA password. Nothing secret is printed.
import * as readline from 'node:readline'
import { stdin, stdout } from 'node:process'
import { optionalEnv, writeEnvValue, ENV_PATH } from '../src/env.ts'
import { newClient, closeClient } from '../src/telegram.ts'

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
  const force = process.argv.includes('--force')
  if (optionalEnv('TELEGRAM_SESSION') && !force) {
    console.log('TELEGRAM_SESSION is already set in .env. Re-run with `npm run telegram:login -- --force` to replace it.')
    return
  }

  console.log('Gramsight: Telegram user-account login (GramJS).')
  console.log('Use your own established account. The session will be written to .env and never printed.\n')

  const client = newClient('')
  try {
    await client.start({
      phoneNumber: () => ask('Phone number, international format (e.g. +9715...): '),
      phoneCode: () => ask('Login code Telegram just sent you: '),
      password: (hint?: string) => askHidden(`2FA password${hint ? ` (hint: ${hint})` : ''}: `),
      onError: (err: Error) => {
        console.error(`Login error: ${err.message}`)
      },
    })

    const session = client.session.save() as unknown as string
    if (!session || typeof session !== 'string') throw new Error('GramJS returned an empty session')
    writeEnvValue('TELEGRAM_SESSION', session)

    const me = await client.getMe()
    console.log(`\nLogged in as user id ${me.id.toString()}${me.username ? ` (@${me.username})` : ''}.`)
    console.log(`Session written to ${ENV_PATH} as TELEGRAM_SESSION (${session.length} characters, not shown).`)
    console.log('Treat it like a password: it gives full access to this Telegram account.')
    console.log('To revoke it: Telegram > Settings > Devices > "Gramsight backend" > Terminate.')
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

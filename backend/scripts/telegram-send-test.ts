// Day 2 check: send ONE message as your own Telegram account (TDLib). You run this yourself.
//   npm run telegram:send-test -- me "Gramsight send test"            dry run: shows chat and text
//   npm run telegram:send-test -- me "Gramsight send test" --send     asks you to type SEND, then sends once
// Default target "me" = your Saved Messages, so nobody else sees the test. Never retries.
import * as readline from 'node:readline'
import { stdin, stdout } from 'node:process'
import { closeClient, connectLoggedIn, resolveChatId, sendTextAsUser } from '../src/telegram.ts'

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true })
  return new Promise((resolve) => rl.question(question, (a) => (rl.close(), resolve(a.trim()))))
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== '--send')
  const doSend = process.argv.includes('--send')
  const target = args[0] ?? 'me'
  const text = args.slice(1).join(' ') || 'Gramsight send test'

  const client = await connectLoggedIn()
  try {
    const chatId = await resolveChatId(client, target)
    const chat = await client.invoke({ _: 'getChat', chat_id: chatId })
    console.log(`Chat: ${chat.title || '(Saved Messages)'} (id ${chatId})`)
    console.log(`Text: ${JSON.stringify(text)}`)
    if (!doSend) {
      console.log('\nDry run only. Add --send to send it as your account.')
      return
    }
    if ((await ask('\nType SEND to send this one message as your account: ')) !== 'SEND') {
      console.log('Cancelled. Nothing was sent.')
      return
    }
    const id = await sendTextAsUser(client, chatId, text)
    console.log(`Sent and confirmed by Telegram (message id ${id}).`)
  } finally {
    await closeClient(client)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(`telegram:send-test failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })

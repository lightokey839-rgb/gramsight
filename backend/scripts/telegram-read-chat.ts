// Reads the last few messages of one chat with the logged-in user account (GramJS).
//   npm run telegram:read -- --list            list your 15 most recent chats (title and id)
//   npm run telegram:read -- me                last 5 messages in Saved Messages
//   npm run telegram:read -- @username 5       last 5 messages with a user or public chat
//   npm run telegram:read -- -1001234567890    by numeric id from --list
// Output goes to your terminal only. Message text is untrusted input: it is printed, never acted on.
import { Api } from 'telegram'
import { connectFromEnv, closeClient } from '../src/telegram.ts'

function oneLine(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function senderLabel(sender: unknown): string {
  if (sender instanceof Api.User) {
    const name = [sender.firstName, sender.lastName].filter(Boolean).join(' ') || 'user'
    return `${name}${sender.bot ? ' [bot]' : ''} (${sender.id.toString()})`
  }
  if (sender instanceof Api.Channel || sender instanceof Api.Chat) return `${sender.title} (${sender.id.toString()})`
  return 'unknown'
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const client = await connectFromEnv()
  try {
    const dialogs = await client.getDialogs({ limit: 50 })

    if (args.length === 0 || args[0] === '--list') {
      console.log('Most recent chats (pass the id or @username to read one):')
      for (const d of dialogs.slice(0, 15)) {
        const kind = d.isUser ? 'user' : d.isChannel ? 'channel' : d.isGroup ? 'group' : 'chat'
        console.log(`  ${String(d.id).padEnd(16)} ${kind.padEnd(8)} ${oneLine(d.title ?? d.name ?? '', 40)}`)
      }
      return
    }

    const target = args[0]
    const limit = Math.min(Math.max(Number(args[1] ?? 5) || 5, 1), 20)
    const entity = /^-?\d+$/.test(target) ? await client.getEntity(BigInt(target) as never) : await client.getEntity(target)
    const messages = await client.getMessages(entity, { limit })

    console.log(`Last ${messages.length} message(s) in ${senderLabel(entity)}:`)
    for (const m of [...messages].reverse()) {
      const when = new Date(m.date * 1000).toISOString().replace('T', ' ').slice(0, 16)
      const sender = await m.getSender().catch(() => undefined)
      const text = m.message ? oneLine(m.message) : m.media ? `[${m.media.className}]` : '[service message]'
      console.log(`  #${m.id} ${when} UTC  ${m.out ? 'me' : senderLabel(sender)}: ${text}`)
    }
  } finally {
    await closeClient(client)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(`telegram:read failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })

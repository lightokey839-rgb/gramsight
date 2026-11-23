// Reads the last few messages of one chat with the logged-in user account (TDLib).
//   npm run telegram:read -- --list            list your 15 most recent chats (title and id)
//   npm run telegram:read -- me                last 5 messages in Saved Messages
//   npm run telegram:read -- @username 5       last 5 messages with a user or public chat
//   npm run telegram:read -- -1001234567890    by chat id from --list
// Output goes to your terminal only. Message text is untrusted input: it is printed, never acted on.
import type { Client } from '../src/telegram.ts'
import { closeClient, connectLoggedIn, resolveChatId } from '../src/telegram.ts'

function oneLine(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const names = new Map<number, string>()

async function userName(client: Client, userId: number): Promise<string> {
  const cached = names.get(userId)
  if (cached) return cached
  let name = `user ${userId}`
  try {
    const u = await client.invoke({ _: 'getUser', user_id: userId })
    name = `${[u.first_name, u.last_name].filter(Boolean).join(' ') || 'user'}${u.type._ === 'userTypeBot' ? ' [bot]' : ''} (${userId})`
  } catch {
    // unknown user: keep the id
  }
  names.set(userId, name)
  return name
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const client = await connectLoggedIn()
  try {
    if (args.length === 0 || args[0] === '--list') {
      try {
        await client.invoke({ _: 'loadChats', chat_list: { _: 'chatListMain' }, limit: 30 })
      } catch {
        // 404 means every chat is already loaded
      }
      const { chat_ids } = await client.invoke({ _: 'getChats', chat_list: { _: 'chatListMain' }, limit: 15 })
      console.log('Most recent chats (pass the id or @username to read one):')
      for (const id of chat_ids) {
        const chat = await client.invoke({ _: 'getChat', chat_id: id })
        const kind = chat.type._.replace('chatType', '').toLowerCase()
        console.log(`  ${String(id).padEnd(16)} ${kind.padEnd(10)} ${oneLine(chat.title, 40)}`)
      }
      return
    }

    const limit = Math.min(Math.max(Number(args[1] ?? 5) || 5, 1), 20)
    const chatId = await resolveChatId(client, args[0])
    const chat = await client.invoke({ _: 'getChat', chat_id: chatId })

    // TDLib may return fewer messages than asked on the first call; page backwards until we have enough.
    const messages: Awaited<ReturnType<typeof getPage>> = []
    async function getPage(from: number) {
      const page = await client.invoke({ _: 'getChatHistory', chat_id: chatId, from_message_id: from, offset: 0, limit, only_local: false })
      return page.messages.filter((m) => m !== null && m !== undefined)
    }
    for (let i = 0; i < 5 && messages.length < limit; i++) {
      const page = await getPage(messages.length ? messages[messages.length - 1].id : 0)
      if (!page.length) break
      messages.push(...page)
    }

    console.log(`Last ${Math.min(messages.length, limit)} message(s) in "${oneLine(chat.title, 40)}" (chat ${chatId}):`)
    for (const m of messages.slice(0, limit).reverse()) {
      const when = new Date(m.date * 1000).toISOString().replace('T', ' ').slice(0, 16)
      const sender = m.is_outgoing
        ? 'me'
        : m.sender_id._ === 'messageSenderUser'
          ? await userName(client, m.sender_id.user_id)
          : `chat ${m.sender_id.chat_id}`
      const text = m.content._ === 'messageText' ? oneLine(m.content.text.text) : `[${m.content._}]`
      console.log(`  #${m.id} ${when} UTC  ${sender}: ${text}`)
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

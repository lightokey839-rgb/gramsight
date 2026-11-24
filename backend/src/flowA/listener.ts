// Watches the user's Telegram (TDLib) for incoming messages that ask for an address, and queues them.
// Private chats: any matching message. Groups: only when the user is mentioned or replied to.
// Message text stays in memory only (never written to disk) and is never logged.
import type { Client } from '../telegram.ts'
import { sendTextAsUser } from '../telegram.ts'
import type { FlowAController, MessageSender } from './controller.ts'
import { detectAddressRequest } from './requests.ts'

export class TdlibSender implements MessageSender {
  constructor(private readonly client: Client) {}
  send(chatId: number, text: string): Promise<number> {
    return sendTextAsUser(this.client, chatId, text)
  }
}

/** Logs instead of sending. The default until GRAMSIGHT_SEND=live. */
export class DryRunSender implements MessageSender {
  private n = 0
  constructor(private readonly log: (line: string) => void = console.log) {}
  async send(chatId: number, text: string): Promise<number> {
    this.log(`[dry-run] would send ${text.length} characters to chat ${chatId}`)
    return ++this.n
  }
}

export function attachRequestListener(client: Client, controller: FlowAController, log: (line: string) => void): () => void {
  const names = new Map<number, string>()
  const onUpdate = (u: { _: string } & Record<string, unknown>) => {
    if (u._ !== 'updateNewMessage') return
    const m = u.message as {
      id: number
      chat_id: number
      is_outgoing: boolean
      contains_unread_mention: boolean
      sender_id: { _: string; user_id?: number }
      content: { _: string; text?: { text: string } }
    }
    if (m.is_outgoing || m.content._ !== 'messageText' || !m.content.text) return
    const hint = detectAddressRequest(m.content.text.text)
    if (!hint) return
    void (async () => {
      try {
        const chat = await client.invoke({ _: 'getChat', chat_id: m.chat_id })
        const isPrivate = chat.type._ === 'chatTypePrivate'
        if (!isPrivate && !m.contains_unread_mention) return // in groups, only when someone tags or replies to you
        if (chat.type._ === 'chatTypePrivate' && chat.type.user_id === (await client.invoke({ _: 'getMe' })).id) return
        let fromName = chat.title
        const uid = m.sender_id._ === 'messageSenderUser' ? m.sender_id.user_id : undefined
        if (uid !== undefined) {
          fromName = names.get(uid) ?? fromName
          if (!names.has(uid)) {
            const user = await client.invoke({ _: 'getUser', user_id: uid })
            fromName = user.first_name || fromName
            names.set(uid, fromName)
          }
        }
        controller.addRequest({
          chatId: m.chat_id,
          chatTitle: isPrivate ? 'Private chat' : chat.title,
          fromName,
          text: m.content.text!.text,
          messageId: m.id,
          ...hint,
        })
      } catch (err) {
        log(`could not queue a request: ${err instanceof Error ? err.message : String(err)}`)
      }
    })()
  }
  client.on('update', onUpdate)
  return () => client.off('update', onUpdate)
}

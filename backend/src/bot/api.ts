// Minimal Telegram Bot API client. The token never appears in errors or logs.

export interface BotApiLike {
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
}

export class BotApiError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    readonly description: string,
  ) {
    super(`Bot API ${method} failed: ${code} ${description}`)
  }
}

type BotResponse<T> = { ok: true; result: T } | { ok: false; error_code: number; description: string }

export class BotApi implements BotApiLike {
  constructor(private readonly token: string) {
    if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) throw new Error('BOT_TOKEN does not look like a bot token from @BotFather')
  }

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 45_000): Promise<T> {
    let res: Response
    try {
      res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).split(this.token).join('<BOT_TOKEN>')
      throw new Error(`Bot API ${method} request failed: ${msg}`)
    }
    const body = (await res.json()) as BotResponse<T>
    if (!body.ok) throw new BotApiError(method, body.error_code, body.description)
    return body.result
  }
}

// The few Bot API shapes the vault bot reads.
export type TgUser = { id: number; is_bot: boolean; first_name?: string; username?: string }
export type TgChat = { id: number; type: 'private' | 'group' | 'supergroup' | 'channel' }
export type TgMessage = { message_id: number; from?: TgUser; chat: TgChat; date: number; text?: string }
export type TgCallbackQuery = { id: string; from: TgUser; message?: { message_id: number; chat: TgChat }; data?: string }
export type TgUpdate = { update_id: number; message?: TgMessage; callback_query?: TgCallbackQuery }

// OpenRouter (OpenAI-compatible chat completions), default provider, used with a free (":free") model.
// Free model IDs come and go: the model is GRAMSIGHT_INTENT_MODEL, default below (listed on 26 Nov 2026).
import { AiBusyError, type AiProvider, type JsonSchema, parseJsonReply } from './provider.ts'

export const DEFAULT_OPENROUTER_MODEL = 'google/gemma-4-31b-it:free'

export class OpenRouterProvider implements AiProvider {
  readonly name = 'OpenRouter'

  constructor(
    private readonly apiKey: string,
    readonly model: string = DEFAULT_OPENROUTER_MODEL,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  async completeJson(req: { system: string; user: string; schema: JsonSchema; schemaName: string; maxTokens?: number }): Promise<unknown> {
    let res: Response
    try {
      res = await this.fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
          'x-title': 'Gramsight',
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          max_tokens: req.maxTokens ?? 300,
          response_format: { type: 'json_schema', json_schema: { name: req.schemaName, strict: true, schema: req.schema } },
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (err) {
      // Network trouble or a timeout: treated like "busy", so the user is told rather than guessed for.
      throw new AiBusyError(`AI unreachable (${err instanceof Error ? err.name : 'error'}), try again`)
    }
    if (res.status === 429) throw new AiBusyError('AI busy (free-tier limit), try again')
    if (res.status === 401 || res.status === 403) throw new Error(`OpenRouter rejected the key (${res.status})`)
    if (!res.ok) throw new AiBusyError(`AI unavailable (${res.status}), try again`)
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string; code?: number } }
    if (body.error) {
      if (body.error.code === 429) throw new AiBusyError('AI busy (free-tier limit), try again')
      throw new AiBusyError(`AI error, try again`)
    }
    const content = body.choices?.[0]?.message?.content
    if (!content) throw new AiBusyError('AI returned nothing, try again')
    return parseJsonReply(content)
  }
}

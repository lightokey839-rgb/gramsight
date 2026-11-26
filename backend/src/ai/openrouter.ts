// OpenRouter (OpenAI-compatible chat completions), default provider, used with free (":free") models.
// Free models are often "temporarily rate-limited upstream", so GRAMSIGHT_INTENT_MODEL may list several,
// comma-separated; on a 429 or an empty reply the next one is tried (at most 2 per call, to save the daily quota).
// Default list checked on 26 Nov 2026: Nemotron 3.5 Super answered (about 14 s, it reasons first),
// the Gemma 4 free models were rate-limited upstream at the time.
import { AiBusyError, type AiProvider, type JsonSchema, parseJsonReply } from './provider.ts'

export const DEFAULT_OPENROUTER_MODELS = ['nvidia/nemotron-3.5-super-vl:free', 'google/gemma-4-31b-it:free']
export const DEFAULT_OPENROUTER_MODEL = DEFAULT_OPENROUTER_MODELS.join(',')

export class OpenRouterProvider implements AiProvider {
  readonly name = 'OpenRouter'
  readonly model: string
  private readonly models: string[]

  constructor(
    private readonly apiKey: string,
    models: string | string[] = DEFAULT_OPENROUTER_MODELS,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 20_000,
    private readonly maxAttempts = 2,
  ) {
    this.models = (Array.isArray(models) ? models : models.split(','))
      .map((m) => m.trim())
      .filter(Boolean)
    if (!this.models.length) throw new Error('No OpenRouter model configured')
    this.model = this.models.join(',')
  }

  async completeJson(req: { system: string; user: string; schema: JsonSchema; schemaName: string; maxTokens?: number }): Promise<unknown> {
    let last: unknown
    for (const model of this.models.slice(0, this.maxAttempts)) {
      try {
        return await this.once(model, req)
      } catch (err) {
        if (!(err instanceof AiBusyError)) throw err // a bad key is not worth a second try
        last = err
      }
    }
    throw last instanceof AiBusyError ? last : new AiBusyError()
  }

  private async once(model: string, req: { system: string; user: string; schema: JsonSchema; schemaName: string; maxTokens?: number }): Promise<unknown> {
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
          model,
          temperature: 0,
          // Room for models that reason before answering; their answer is short.
          max_tokens: Math.max(req.maxTokens ?? 0, 800),
          reasoning: { effort: 'low' },
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
    const body = (await res.json()) as { choices?: { message?: { content?: string | null } }[]; error?: { message?: string; code?: number } }
    if (body.error) {
      if (body.error.code === 401 || body.error.code === 403) throw new Error('OpenRouter rejected the key')
      throw new AiBusyError(body.error.code === 429 ? 'AI busy (free-tier limit), try again' : 'AI error, try again')
    }
    const content = body.choices?.[0]?.message?.content
    if (!content) throw new AiBusyError('AI returned nothing, try again')
    try {
      return parseJsonReply(content)
    } catch {
      throw new AiBusyError('AI reply was not JSON, try again')
    }
  }
}

// One small interface for the AI used by Gramsight: it returns JSON for a strict schema, nothing else.
// The AI never sees an address, a key or a seed phrase, and its output is always re-validated by code.
// Free tiers are small (OpenRouter: about 50 requests a day on free models), so callers go rules-first,
// identical inputs are cached, and a rate limit surfaces as AiBusyError, never as a silent guess.
import { createHash } from 'node:crypto'

export class AiBusyError extends Error {
  constructor(message = 'AI busy, try again') {
    super(message)
    this.name = 'AiBusyError'
  }
}

export type JsonSchema = Record<string, unknown>

export interface AiProvider {
  readonly name: string
  readonly model: string
  /** Returns the parsed JSON object the model produced for this schema. Throws AiBusyError on rate limits. */
  completeJson(req: { system: string; user: string; schema: JsonSchema; schemaName: string; maxTokens?: number }): Promise<unknown>
}

/** Parses a model's JSON reply, tolerating a ```json fence around it. */
export function parseJsonReply(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(t)
}

/**
 * Caches identical requests and enforces a daily request budget (UTC day), so a free tier is never
 * exhausted by repeats. Over budget it throws AiBusyError, the same as a rate limit.
 */
export class BudgetedAi implements AiProvider {
  private readonly cache = new Map<string, { at: number; value: unknown }>()
  private day = ''
  private used = 0

  constructor(
    private readonly inner: AiProvider,
    private readonly dailyLimit = 40,
    private readonly ttlMs = 24 * 60 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  get name(): string {
    return this.inner.name
  }

  get model(): string {
    return this.inner.model
  }

  /** Requests made today (for logs and tests). */
  usedToday(): number {
    this.rollDay()
    return this.used
  }

  private rollDay(): void {
    const d = new Date(this.now()).toISOString().slice(0, 10)
    if (d !== this.day) {
      this.day = d
      this.used = 0
    }
  }

  async completeJson(req: { system: string; user: string; schema: JsonSchema; schemaName: string; maxTokens?: number }): Promise<unknown> {
    const key = createHash('sha256').update(`${this.inner.model}\n${req.schemaName}\n${req.system}\n${req.user}`).digest('hex')
    const hit = this.cache.get(key)
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value
    this.rollDay()
    if (this.used >= this.dailyLimit) throw new AiBusyError('AI daily budget used, try again tomorrow')
    this.used++
    const value = await this.inner.completeJson(req)
    if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(key, { at: this.now(), value })
    return value
  }
}

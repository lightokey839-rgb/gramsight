// Claude as an alternative provider (GRAMSIGHT_AI=claude, ANTHROPIC_API_KEY). Paid, so off by default.
// Strict JSON schema output, effort low, server-side refusal fallbacks, one quick attempt.
import Anthropic from '@anthropic-ai/sdk'
import { AiBusyError, type AiProvider, type JsonSchema, parseJsonReply } from './provider.ts'

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5'

export class ClaudeProvider implements AiProvider {
  readonly name = 'Claude'

  constructor(
    private readonly client: Anthropic,
    readonly model: string = DEFAULT_CLAUDE_MODEL,
  ) {}

  async completeJson(req: { system: string; user: string; schema: JsonSchema; schemaName: string; maxTokens?: number; timeoutMs?: number }): Promise<unknown> {
    let response
    try {
      response = await this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: Math.max(req.maxTokens ?? 0, 2048),
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low', format: { type: 'json_schema', schema: req.schema } },
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
        },
        { timeout: 10_000, maxRetries: 0 },
      )
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) throw new AiBusyError('AI busy, try again')
      if (err instanceof Anthropic.AuthenticationError) throw err
      throw new AiBusyError('AI unavailable, try again')
    }
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') throw new AiBusyError('AI could not answer, try again')
    const block = response.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') throw new AiBusyError('AI returned nothing, try again')
    return parseJsonReply(block.text)
  }
}

// Picks the AI provider from .env:
//   GRAMSIGHT_AI=openrouter (default when OPENROUTER_API_KEY is set) | claude | off
//   GRAMSIGHT_INTENT_MODEL  model id for whichever provider is active
//   GRAMSIGHT_AI_DAILY_LIMIT  requests per day before "AI busy" (default 40, under OpenRouter's 50 free)
import Anthropic from '@anthropic-ai/sdk'
import { optionalEnv } from '../env.ts'
import { ClaudeProvider, DEFAULT_CLAUDE_MODEL } from './claude.ts'
import { DEFAULT_OPENROUTER_MODEL, OpenRouterProvider } from './openrouter.ts'
import { type AiProvider, BudgetedAi } from './provider.ts'

export function aiFromEnv(): AiProvider | undefined {
  const choice = (optionalEnv('GRAMSIGHT_AI') ?? '').toLowerCase()
  if (choice === 'off') return undefined
  const limit = Number(optionalEnv('GRAMSIGHT_AI_DAILY_LIMIT') ?? 40) || 40
  const model = optionalEnv('GRAMSIGHT_INTENT_MODEL')

  if (choice === 'claude') {
    const apiKey = optionalEnv('ANTHROPIC_API_KEY') ?? optionalEnv('LLM_API_KEY')
    if (!apiKey) throw new Error('GRAMSIGHT_AI=claude needs ANTHROPIC_API_KEY')
    return new BudgetedAi(new ClaudeProvider(new Anthropic({ apiKey }), model ?? DEFAULT_CLAUDE_MODEL), limit)
  }
  const key = optionalEnv('OPENROUTER_API_KEY')
  if (!key) {
    if (choice === 'openrouter') throw new Error('GRAMSIGHT_AI=openrouter needs OPENROUTER_API_KEY')
    return undefined // no key: rules and fixed templates only
  }
  return new BudgetedAi(new OpenRouterProvider(key, model ?? DEFAULT_OPENROUTER_MODEL), limit)
}

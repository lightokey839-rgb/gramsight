// Runs only the vault bot:  npm run bot
import { runVaultBot } from './run.ts'

runVaultBot().catch((err: unknown) => {
  console.error(`[vault-bot] stopped: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})

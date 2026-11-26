# AI, voice and the wallet path: what was verified (26 Nov 2026)

Simulator 0.9.5 with the backend in dry-run and a scratch vault. The user's real OpenRouter key was used for a handful of free-model requests. There is no Groq key yet, and no TON Connect manifest is hosted yet.

| File | What it shows |
|---|---|
| `day6-01-ai-reason-lookalike.png` | A lookalike of contact Ada: the fixed reason "Looks like contact ada, but the middle differs." No "Tap: talk", because the card is blocked. |
| `day6-02-request-tap-talk.png` | A request card with "Tap: talk" |
| `day6-03-listening.png` | After a simulator tap: "Listening... tap to stop" (the console logs `mic on`) |
| `day6-04-voice-not-set-up.png` | Second tap with no Groq key: "Voice is not set up (GROQ_API_KEY). Type the command instead." |
| `day6-05-understood-by-ai.png` | "hmm the usual one for her" → "Solana main (understood by AI)". It took about 9 s via `nvidia/nemotron-3.5-super-vl:free`. |

Findings:

- **The AI intent fallback works with a real free model.** Phrases the rules understand ("can u send ada my sol addy") make no AI call at all.
- **OpenRouter free models were often "temporarily rate-limited upstream"** (Gemma 4 31B and 26B, Ling 3.2). Nemotron 3.5 Super answered (about 14 s, it reasons first), and Nemotron Lightning spent its tokens on reasoning.
  - `GRAMSIGHT_INTENT_MODEL` therefore takes a list, and a 429 or empty reply tries the next model.
  - When all are busy, an unclear command shows "AI busy, try again". The verdict reason keeps its fixed template; the AI wording replaces it only when it arrives and passes the safety filter (no addresses, digits or links).
- **TON Connect from Node:** the SDK produced a Tonkeeper pairing link with a placeholder manifest. A real wallet approval still needs the manifest hosted over HTTPS and a Tonkeeper testnet account.
- **Two voice bugs were found in this run and fixed** (commits `6457d4e`, `4ea1bac`):
  - The backend answered before reading the audio, so the proxy showed a 500.
  - The "Listening" overlay was overwritten when drawn inside the tap event.

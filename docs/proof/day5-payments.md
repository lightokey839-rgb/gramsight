# Day 5 proof: paying from the verdict card (simulator, dry-run rail, 26 Nov 2026)

Backend with `GRAMSIGHT_PAY=dry-run` (the payment step logs instead of broadcasting) and the default limits (1 Gram per payment, 3 Gram per 24 h). Scratch vault with contact `ada`. Simulator 0.9.5. Addresses were simulated with `POST /api/dev/share`, commands typed with `POST /api/command`, and taps were real simulator inputs.

| File | Card |
|---|---|
| `day5-01-verdict-pay-hint.png` | Verdict "MATCHES SAVED CONTACT ADA" now ends with "Say: send 1 Gram" |
| `day5-02-over-limit.png` | "send 5 gram" → "Over your limit. Max 1 Gram per payment." |
| `day5-03-pay-card.png` | "send 1 Gram" → "PAY Ada · Private chat / 1 Gram · TON testnet / start…middle…end / MATCHES SAVED CONTACT ADA / Tap: pay" |
| `day5-04-sent.png` | After a simulator tap: "SENT 1 Gram → Ada / TON testnet (dry run) · tx …" |
| `day5-05-confirm-twice.png` | The real 23 Nov spam sender, "NEW ADDRESS, BE CAREFUL": the payment card asks "Say "confirm", then tap." |
| `day5-06-confirmed-armed.png` | After "confirm": "Tap: pay" |

What was checked:

- **Taps before "confirm" do nothing.** A tap on the new-address payment card before "confirm" was ignored: the card stayed on `pay` and nothing reached the payment step. After "confirm", one tap paid once, and the backend log shows one `[dry-run] would pay 500000000 nanoGram`.
- **A bug the simulator run found, now fixed (commit `39e3abb`).** The spam sender first came back as "YOU PAID THIS ADDRESS BEFORE". Its 0.001 Gram had bounced off the uninitialised payer, and the bounce, an outgoing message, was counted as a payment: the exact address-poisoning path the checker exists to stop. Now only wallet-signed transfers count. The real payer's history reads 0 signed transfers, and dry-run payments never count as trust or against limits.

Not yet done: a **live** testnet payment through the glasses flow (`GRAMSIGHT_PAY=live`). The first live broadcast waits for the user's approval.

# Demo day runbook (live, TON testnet)

Exact steps for one live pass of every demo moment, then the video. You run the commands and make every live send yourself.

Never paste recovery words anywhere. Type them from paper, and only into the wallet app.

## 0. One-time setup (about 15 minutes)

1. **Tonkeeper on your phone, testnet.**
   - Open the Dev menu, then **Import Testnet Wallet**.
   - Type your 24 words from paper. These are the words of the wallet you made on wallet.ton.org.
   - Check the address Tonkeeper shows. It must start `0QA04eYU` and end `izf-2`, and it holds 2 test Gram.
   - If it differs, Tonkeeper picked another wallet version. Choose the one with the 2 Gram balance.
2. **Vault bot** (@addressvault_bot, with the backend running, see step 1). Send these; each needs a Confirm tap:
   - `/start`
   - `/add ton main 0QA04eYUjjWoZkp9DR1kGnE1a1WCwIaXFz77fRizjTlizf-2`: your address, used for Flow A
   - `/contact ton ada 0QDFNkha4el60EnN_1CO813EcRLDLjsInqkvIIZzw-4fmull`: a demo contact. Nobody owns it; it is only there to be imitated.
   - Optional, not used in the video: `/contact ton bo 0QDt57eVDqXxmNgwyCZIZZr35DtaO0u_HMH-Vy9ub9IUgtcl`.
   - Ada and Bo are generated demo addresses that nobody owns, so test Gram sent to them is simply gone, which is fine on testnet.

## 1. Start everything live (three PowerShell windows)

These settings apply only to this window; `.env` stays on dry-run.

```powershell
cd C:\Users\HomePC\Projects\gramsight\backend; $env:GRAMSIGHT_DEV='1'; $env:GRAMSIGHT_SEND='live'; $env:GRAMSIGHT_PAY='live'; npm start
```

```powershell
cd C:\Users\HomePC\Projects\gramsight\g2-app; npm run dev
```

```powershell
evenhub-simulator http://localhost:5173
```

The backend should print `sending: live`, `payments: live` and `wallet path (TON Connect): on`.

## 2. Pair Tonkeeper (once)

1. Open http://localhost:5173 in your browser.
2. Under "Your testnet wallet", pick **Tonkeeper**, press **Connect wallet**, then scan the QR code with Tonkeeper and approve.
3. The page shows `Connected: Tonkeeper · 0QA04e…izf-2 (testnet)`.

## 3. The demo moments, in order

Each line below gives the action, then what you should see.

1. **Flow A: someone asks for your address. This sends a real message to your Saved Messages.**
   - On the page, Simulate request with `hey can you send me your ton address?` The glasses show the request.
   - Type (or say) `send my ton address`. The confirm card shows "TON main" and the address start, middle and end.
   - Tap in the simulator. The address arrives in **Saved Messages** in Telegram.
2. **Flow B, blocked.**
   - In "simulate someone sending you an address", use sender `Ada` and address `0QDFNkiKOGx2AV2eFOt5-be_nzIuggviSYMv88LiDxSlUull`.
   - The glasses show "LOOKALIKE OF CONTACT ADA … Payment blocked", plus the reason line.
3. **Flow B, hands-free payment** (backend payer, 1 Gram).
   - Sender `Bo`, address `0QDt57eVDqXxmNgwyCZIZZr35DtaO0u_HMH-Vy9ub9IUgtcl`. The glasses show "MATCHES SAVED CONTACT BO".
   - Say `send 1 Gram`, then tap. The glasses show "SENT 1 Gram"; check it on testnet.tonviewer.com.
4. **Flow B, new address (no wallet paired).**
   - Sender `Cy`, address `0QCdyJOCmBGSSlmo7apsZXpfO-uyNwTZ2gusywDB2vsC8GrU`.
   - The glasses show "NEW ADDRESS, BE CAREFUL". Say `send 1 Gram`. The card shows "Say "confirm", then tap".
   - Stop there and double-tap to cancel. In the video, say: "With a wallet paired, this goes to your wallet app to approve."
5. **Voice.** On any card that shows "Tap: talk", tap, speak, then tap again. The card shows what was heard and acts on it.

Steps 0.1 (Tonkeeper) and 2 (pairing) are optional; skip them today.

## 4. The video (1 to 3 minutes)

Organizer rules: one real moment from someone's day, start to finish; live in the simulator with real data, no slides; show step by step how a user connects their account; and one sentence on what Gramsight does that Even AI can't. An AI voiceover is fine.

**Keep private things off camera:** your phone number, login codes, `.env`, recovery words and bot token. Close those windows before recording.

1. **0:00-0:15, pitch.**
   - On screen: the simulator on the idle card.
   - Say: "Gramsight is an AI wallet assistant for Telegram on your G2 glasses. Even AI answers questions; Gramsight acts inside your own Telegram account and wallet: it checks whether an address really belongs to the person who sent it, blocks lookalikes, and pays on testnet only after your tap."
2. **0:15-0:45, connecting your accounts.**
   - Telegram: show the backend window line `Telegram user account connected (TDLib)`. Say: "Once, you log in with `npm run telegram:login` in your own terminal; Gramsight never sees your code." Don't re-run the login on camera.
   - Vault: in @addressvault_bot, show `/start`, then `/add ton main …` and the Confirm tap.
   - Phone page: show http://localhost:5173 (the command box and the wallet section).
3. **0:45-2:15, one moment, start to finish. Ada is a friend in "Weekend trip".**
   - Ada asks for your address: Simulate request `hey can you send me your ton address?`
   - Say or type `send my ton address`, check the card, tap. Then show it arriving in **Saved Messages** in Telegram.
   - Ada sends an address back. First a poisoned lookalike: sender `Ada`, `0QDFNkiKOGx2AV2eFOt5-be_nzIuggviSYMv88LiDxSlUull`. The glasses show **LOOKALIKE OF CONTACT ADA**, payment blocked.
   - Then her real one: sender `Ada`, `0QDFNkha4el60EnN_1CO813EcRLDLjsInqkvIIZzw-4fmull`. The glasses show **MATCHES SAVED CONTACT ADA**.
   - Say `send 1 Gram`, then tap. The glasses show **SENT**. Open the tx on testnet.tonviewer.com.
4. **2:15-2:40, safety and voice.**
   - Sender `Cy`, `0QCdyJOCmBGSSlmo7apsZXpfO-uyNwTZ2gusywDB2vsC8GrU`. The glasses show NEW ADDRESS. Use **tap to talk** and say `send 1 Gram`; the card asks "Say confirm, then tap". Double-tap to cancel.
   - Say: "Risky payments need a spoken confirm plus a tap. The AI only reads what you said; it never sees or writes an address."
5. **2:40-2:50, close.** Show https://github.com/lightokey839-rgb/gramsight.

## 5. Record and submit

- Record with Windows key + Alt + R (Xbox Game Bar).
- Upload it to YouTube as **Unlisted**, and put the link in `docs/SUBMISSION.md`.
- DoraHacks lets you submit early and edit the BUIDL until the deadline. Answers to the organizer's extra questions can't be changed after submitting.
- Deadline: Sun 29 Nov, 23:59 Dubai time (19:59 UTC).

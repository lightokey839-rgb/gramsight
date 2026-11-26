import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { FlowAController } from '../src/flowA/controller.ts'
import { createApiServer } from '../src/http.ts'
import { GroqTranscriber, type Transcriber, VoiceBusyError, pcmToWav } from '../src/voice/groq.ts'
import { VaultStore } from '../src/vault/store.ts'

const dir = mkdtempSync(join(tmpdir(), 'gramsight-voice-'))
after(() => rmSync(dir, { recursive: true, force: true }))

const second = (s: number) => Buffer.alloc(Math.round(16_000 * 2 * s))

test('WAV header: 16 kHz, 16-bit, mono PCM', () => {
  const wav = pcmToWav(second(1))
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
  assert.equal(wav.readUInt16LE(22), 1)
  assert.equal(wav.readUInt32LE(24), 16_000)
  assert.equal(wav.readUInt16LE(34), 16)
  assert.equal(wav.readUInt32LE(40), 32_000)
  assert.equal(wav.length, 44 + 32_000)
})

test('Groq: whisper-large-v3-turbo, English, vocabulary hint; 429 is "voice busy"', async () => {
  let form: FormData | undefined
  const ok = (async (_u: string | URL | Request, init?: RequestInit) => {
    form = init?.body as FormData
    return new Response(JSON.stringify({ text: ' Send my Solana address. ' }), { status: 200 })
  }) as typeof fetch
  assert.equal(await new GroqTranscriber('k', undefined, ok).transcribe(second(1)), 'Send my Solana address.')
  assert.equal(form?.get('model'), 'whisper-large-v3-turbo')
  assert.equal(form?.get('language'), 'en')
  assert.match(String(form?.get('prompt')), /Gram/)
  const limited = (async () => new Response('{}', { status: 429 })) as typeof fetch
  await assert.rejects(new GroqTranscriber('k', undefined, limited).transcribe(second(1)), VoiceBusyError)
})

test('/api/voice: audio -> transcript -> the same path as a typed command', async () => {
  const store = new VaultStore(join(dir, 'v.json'))
  store.upsert('solana', 'main', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
  const ctl = new FlowAController(store, { send: async () => 1 })
  ctl.addRequest({ chatId: 1, chatTitle: 'Weekend trip', fromName: 'Ada', text: 'sol addy?', chain: 'solana' })
  const heard: Buffer[] = []
  const stt: Transcriber = {
    async transcribe(pcm) {
      heard.push(pcm)
      return 'can u send ada my sol addy'
    },
  }
  const server = createApiServer({ screen: ctl, stt })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/voice`
  const post = (b: Buffer) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(b) }).then(
      (r) => r.json() as Promise<{ transcript: string; error?: string; card: { kind: string } }>,
    )
  try {
    const tooShort = await post(second(0.1))
    assert.equal(tooShort.error, "Didn't hear anything")
    assert.equal(heard.length, 0)
    const ok = await post(second(1.5))
    assert.equal(ok.transcript, 'can u send ada my sol addy')
    assert.equal(ok.card.kind, 'confirm')
    assert.equal(heard[0].length, 48_000)
  } finally {
    server.close()
  }

  const noVoice = createApiServer({ screen: ctl })
  await new Promise<void>((r) => noVoice.listen(0, '127.0.0.1', r))
  try {
    const res = await fetch(`http://127.0.0.1:${(noVoice.address() as AddressInfo).port}/api/voice`, { method: 'POST', body: new Uint8Array(second(1)) })
    assert.equal(res.status, 400)
  } finally {
    noVoice.close()
  }
})

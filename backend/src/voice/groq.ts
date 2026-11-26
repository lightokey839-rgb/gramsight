// Speech-to-text with Groq Whisper (whisper-large-v3-turbo, free plan). The glasses stream 16 kHz, 16-bit mono PCM;
// the backend wraps it in a WAV header and sends it to Groq. Only the short command audio leaves the backend,
// only to Groq, and nothing is stored. Key: GROQ_API_KEY (console.groq.com -> API Keys).
import { optionalEnv } from '../env.ts'

export class VoiceBusyError extends Error {
  constructor(message = 'Voice busy, try again') {
    super(message)
    this.name = 'VoiceBusyError'
  }
}

export interface Transcriber {
  transcribe(pcm: Buffer): Promise<string>
}

/** 44-byte RIFF/WAVE header + PCM (16-bit little-endian, mono). */
export function pcmToWav(pcm: Buffer, sampleRate = 16_000): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + pcm.length, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16) // fmt chunk size
  h.writeUInt16LE(1, 20) // PCM
  h.writeUInt16LE(1, 22) // mono
  h.writeUInt32LE(sampleRate, 24)
  h.writeUInt32LE(sampleRate * 2, 28) // byte rate
  h.writeUInt16LE(2, 32) // block align
  h.writeUInt16LE(16, 34) // bits per sample
  h.write('data', 36)
  h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

export const DEFAULT_STT_MODEL = 'whisper-large-v3-turbo'

export class GroqTranscriber implements Transcriber {
  constructor(
    private readonly apiKey: string,
    private readonly model = DEFAULT_STT_MODEL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async transcribe(pcm: Buffer): Promise<string> {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(pcmToWav(pcm))], { type: 'audio/wav' }), 'command.wav')
    form.append('model', this.model)
    form.append('language', 'en')
    form.append('response_format', 'json')
    form.append('temperature', '0')
    // Vocabulary hint, so chain names and Gram come out spelled right.
    form.append('prompt', 'Gram, TON, Solana, Ethereum, Base, Bitcoin, Tron, address, send, confirm, cancel, next.')
    let res: Response
    try {
      res = await this.fetchImpl('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new VoiceBusyError('Voice service unreachable, try again')
    }
    if (res.status === 429) throw new VoiceBusyError('Voice busy (free-plan limit), try again')
    if (res.status === 401 || res.status === 403) throw new Error(`Groq rejected the key (${res.status})`)
    if (!res.ok) throw new VoiceBusyError(`Voice service error (${res.status}), try again`)
    const body = (await res.json()) as { text?: string }
    return (body.text ?? '').trim()
  }
}

export function transcriberFromEnv(): Transcriber | undefined {
  const key = optionalEnv('GROQ_API_KEY')
  return key ? new GroqTranscriber(key, optionalEnv('GRAMSIGHT_STT_MODEL') ?? DEFAULT_STT_MODEL) : undefined
}

/**
 * MiniMax T2A client for drama VO. Uses MINIMAX_API_KEY / MINIMAX_TTS_* — never the video key.
 */
import { isInsufficientBalanceError } from '../../utils/provider-error.js'
import {
  resolveLanguageBoost,
  resolveMiniMaxVoiceId,
  resolveTtsSpeed,
  type TtsEmotion,
} from './minimax-voice.js'

const TTS_INSUFFICIENT_BALANCE = 'MiniMax TTS 帳戶餘額不足，該鏡改為不帶配音參考出片。'

function ttsBaseUrl() {
  return String(process.env.MINIMAX_TTS_BASE_URL || 'https://api.minimax.io').trim().replace(/\/+$/, '')
}

function ttsApiKey() {
  return String(process.env.MINIMAX_API_KEY || '').trim()
}

function ttsModel() {
  return String(process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd').trim() || 'speech-2.8-hd'
}

function ttsTimeoutMs() {
  const n = Number(process.env.MINIMAX_TTS_TIMEOUT_MS || 120000)
  return Number.isFinite(n) && n > 0 ? n : 120000
}

export function isMiniMaxTtsConfigured() {
  return Boolean(ttsApiKey())
}

function assertMiniMaxOk(data: any, context: string) {
  const statusCode = data?.base_resp?.status_code
  if (statusCode === 0 || statusCode === undefined) return
  const msg = data?.base_resp?.status_msg || `MiniMax API error (${statusCode})`
  throw new Error(`${context}: ${msg}`)
}

async function synthesizeOnce(payload: Record<string, unknown>) {
  const key = ttsApiKey()
  if (!key) throw new Error('MINIMAX_API_KEY is not configured')
  const resp = await fetch(`${ttsBaseUrl()}/v1/t2a_v2`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(ttsTimeoutMs()),
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const msg = String((data as any)?.base_resp?.status_msg || (data as any)?.message || resp.status)
    if (isInsufficientBalanceError(msg) || resp.status === 402) {
      throw new Error(TTS_INSUFFICIENT_BALANCE)
    }
    throw new Error(`MiniMax T2A: ${msg}`)
  }
  assertMiniMaxOk(data, 'MiniMax T2A')
  const audioHex = String((data as any)?.data?.audio || '').trim()
  if (!audioHex) throw new Error('MiniMax TTS returned empty audio')
  return Buffer.from(audioHex, 'hex')
}

export async function synthesizeMiniMaxMp3(opts: {
  text: string
  voiceId: string
  languageCode?: string | null
  speed?: number | null
  emotion?: TtsEmotion | null
}): Promise<Buffer> {
  const text = String(opts.text || '').trim()
  if (!text) throw new Error('TTS text is empty')
  const voiceId = resolveMiniMaxVoiceId(opts.voiceId)
  const languageBoost = resolveLanguageBoost(opts.languageCode)
  const speed = resolveTtsSpeed(opts.speed)
  const emotion = opts.emotion || null

  const basePayload: Record<string, unknown> = {
    model: ttsModel(),
    text,
    stream: false,
    language_boost: languageBoost,
    output_format: 'hex',
    voice_setting: {
      voice_id: voiceId,
      speed,
      vol: 1,
      pitch: 0,
      ...(emotion ? { emotion } : {}),
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',
      channel: 1,
    },
  }

  try {
    return await synthesizeOnce(basePayload)
  } catch (err) {
    const msg = String((err as Error)?.message || err || '')
    if (emotion && /emotion|不支持|不支援|unsupported/i.test(msg)) {
      const retry = { ...basePayload, voice_setting: { voice_id: voiceId, speed, vol: 1, pitch: 0 } }
      return await synthesizeOnce(retry)
    }
    throw err
  }
}

export { TTS_INSUFFICIENT_BALANCE }

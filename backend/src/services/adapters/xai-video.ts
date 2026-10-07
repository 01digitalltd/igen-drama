/**
 * xAI Grok Imagine video — POST /v1/videos/generations → { request_id }
 * Poll: GET /v1/videos/{request_id}
 *
 * Realistic dramas use reference-to-video: character/scene/prop stills in
 * reference_images (max 7) and preset voice_id clips in reference_audios
 * (max 3). Custom audio files are not sent.
 */
import type {
  VideoProviderAdapter,
  ProviderRequest,
  AIConfig,
  VideoGenerationRecord,
  VideoGenResponse,
  VideoPollResponse,
} from './types'
import { joinProviderUrl } from './url'

const DEFAULT_MODEL = 'grok-imagine-video-1.5'
const DEFAULT_BASE = 'https://api.x.ai/v1'
export const XAI_MAX_REFERENCE_IMAGES = 7
export const XAI_MAX_REFERENCE_VOICES = 3
const ASPECT_RATIOS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'])

export const XAI_MODERATION_BLOCK_ZH_HANT =
  'xAI 審核未通過，成片沒有可下載的影片。請改寫提示或更換參考圖後再出一次。'

export type XaiVoiceRef = {
  voiceId: string
  speaker?: string
  kind?: string
}

function parseUrlArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((item) => typeof item === 'string' && item.trim()) : []
  } catch {
    return []
  }
}

export function parseXaiVoiceRefs(raw?: string | null): XaiVoiceRef[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.flatMap((item) => {
      const voiceId = String(item?.voiceId || item?.voice_id || '').trim()
      if (!voiceId) return []
      return [{
        voiceId,
        speaker: String(item?.speaker || '').trim(),
        kind: String(item?.kind || '').trim(),
      }]
    }).slice(0, XAI_MAX_REFERENCE_VOICES)
  } catch {
    return []
  }
}

export function normalizeXaiDuration(duration?: number | null) {
  const parsed = Math.round(Number(duration || 8))
  if (!Number.isFinite(parsed)) return 8
  return Math.min(15, Math.max(1, parsed))
}

export function normalizeXaiAspectRatio(ratio?: string | null) {
  const value = String(ratio || '').trim()
  return ASPECT_RATIOS.has(value) ? value : '16:9'
}

export class XaiVideoAdapter implements VideoProviderAdapter {
  provider = 'xai'

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest {
    const model = record.model || config.model || DEFAULT_MODEL
    const prompt = (record.prompt || '').trim()
    const refImages = parseUrlArray(record.referenceImageUrls).slice(0, XAI_MAX_REFERENCE_IMAGES)
    const voices = parseXaiVoiceRefs(record.xaiReferenceAudios)
    if (!prompt && !refImages.length) {
      throw new Error('xAI 參考圖生成需要提示詞或至少一張參考圖')
    }

    const body: Record<string, unknown> = {
      model,
      duration: normalizeXaiDuration(record.duration),
      aspect_ratio: normalizeXaiAspectRatio(record.aspectRatio),
      resolution: '720p',
    }
    if (prompt) body.prompt = prompt
    if (refImages.length) {
      body.reference_images = refImages.map((url) => ({ url }))
    }
    if (voices.length) {
      body.reference_audios = voices.map((voice) => ({ voice_id: voice.voiceId }))
    }

    const base = (config.baseUrl || DEFAULT_BASE).replace(/\/+$/, '')
    return {
      url: joinProviderUrl(base, '/v1', '/videos/generations'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body,
    }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    const requestId = String(result?.request_id || result?.requestId || '').trim()
    if (requestId) return { isAsync: true, taskId: requestId }
    throw new Error('No request_id in xAI video response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    const base = (config.baseUrl || DEFAULT_BASE).replace(/\/+$/, '')
    return {
      url: joinProviderUrl(base, '/v1', `/videos/${encodeURIComponent(taskId)}`),
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    const status = String(result?.status || '').toLowerCase()
    if (status === 'done') {
      const video = result?.video || {}
      const url = String(video.url || '').trim()
      if (video.respect_moderation === false || !url) {
        return { status: 'failed', error: XAI_MODERATION_BLOCK_ZH_HANT }
      }
      return { status: 'completed', videoUrl: url }
    }
    if (status === 'failed' || status === 'expired' || status === 'error') {
      const err = result?.error
      const message = typeof err === 'string'
        ? err
        : (err?.message || (err ? JSON.stringify(err) : '') || 'xAI video generation failed')
      const code = err && typeof err === 'object' && err.code ? `[${err.code}] ` : ''
      return { status: 'failed', error: `${code}${message}` }
    }
    return { status: 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    return result?.video?.url || result?.video_url || null
  }

  extractVideoBase64(_result: any): { data: string; mimeType: string } | null {
    return null
  }
}

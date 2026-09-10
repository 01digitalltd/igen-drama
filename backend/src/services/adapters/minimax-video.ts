/**
 * MiniMax H3 video — POST /v2/video_generation → { task_id }
 * Poll: GET /v2/query/video_generation/{task_id} → { task: { status, content.url, error } }
 *
 * Official modes are mutually exclusive:
 * - t2va  text only; ratio required, not adaptive
 * - i2va  text + first_frame / last_frame; ratio always adaptive
 * - r2va  text + reference_image / reference_video / reference_audio
 *
 * MiniMax-H3-Max is t2va / i2va only (no r2va), 480P/768P, 5–15s.
 * Resolution defaults to 768P; H3 only sends 2K when resolution is explicitly 2K.
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
import { annotateMiniMaxSensitiveBlock } from '../../utils/provider-error.js'

const H3_MODEL_PREFIX = 'minimax-h3'
const DEFAULT_MODEL = 'MiniMax-H3'
const REF_LIMITS = { images: 9, videos: 3, audios: 3 } as const
const PROMPT_MAX_CHARS = 7000
const VALID_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'])

export type MiniMaxVideoMode = 't2va' | 'i2va' | 'r2va'

function parseUrlArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((u) => typeof u === 'string' && u.trim()) : []
  } catch {
    return []
  }
}

function uniqueUrls(urls: string[]) {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of urls) {
    const url = String(raw || '').trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
}

export function isMiniMaxH3Model(model?: string | null) {
  return String(model || '').toLowerCase().startsWith(H3_MODEL_PREFIX)
}

export function isMiniMaxH3Max(model?: string | null) {
  return String(model || '').toLowerCase().includes('h3-max')
}

export function chooseMiniMaxVideoMode(opts: {
  model?: string | null
  refImages?: number
  refVideos?: number
  refAudios?: number
  firstFrame?: boolean
  lastFrame?: boolean
}): MiniMaxVideoMode {
  const refs = (opts.refImages || 0) + (opts.refVideos || 0) + (opts.refAudios || 0)
  const frames = Boolean(opts.firstFrame || opts.lastFrame)
  if (isMiniMaxH3Max(opts.model) && refs > 0) {
    throw new Error('MiniMax-H3-Max 不支持参考图/视频/音频，请改用 MiniMax-H3，或只传首尾帧')
  }
  if (refs > 0) return 'r2va'
  if (frames) return 'i2va'
  return 't2va'
}

export function normalizeMiniMaxDuration(duration?: number | null, model?: string | null) {
  const min = isMiniMaxH3Max(model) ? 5 : 4
  const parsed = Math.round(Number(duration || min))
  if (!Number.isFinite(parsed)) return min
  return Math.min(15, Math.max(min, parsed))
}

export function normalizeMiniMaxResolution(resolution?: string | null, model?: string | null) {
  const r = String(resolution || '').toLowerCase()
  if (isMiniMaxH3Max(model)) {
    if (r === '480p' || r === '480') return '480P'
    return '768P'
  }
  if (r === '2k') return '2K'
  return '768P'
}

function providerCreateError(result: any): string | null {
  const err = result?.error
  if (typeof err === 'string' && err.trim()) return annotateMiniMaxSensitiveBlock(err.trim())
  if (err && typeof err === 'object') {
    const message = String(err.message || '').trim()
    const code = err.code ? `[${err.code}] ` : ''
    if (message) return annotateMiniMaxSensitiveBlock(`${code}${message}`)
  }
  if (typeof result?.message === 'string' && result.message.trim()) {
    return annotateMiniMaxSensitiveBlock(result.message.trim())
  }
  return null
}

export class MiniMaxVideoAdapter implements VideoProviderAdapter {
  provider = 'minimax'

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest {
    const model = record.model || config.model || DEFAULT_MODEL
    if (!isMiniMaxH3Model(model)) {
      throw new Error(`仅支持 MiniMax H3 系列模型（MiniMax-H3 / MiniMax-H3-Max），当前: ${model}`)
    }

    const prompt = (record.prompt || '').trim()
    if (!prompt) throw new Error('MiniMax H3 要求必须提供提示词（text content）')
    if (prompt.length > PROMPT_MAX_CHARS) {
      throw new Error(`提示词超长：MiniMax H3 上限 ${PROMPT_MAX_CHARS} 字符，当前 ${prompt.length}`)
    }

    let refImages = uniqueUrls(parseUrlArray(record.referenceImageUrls))
    const refVideos = uniqueUrls(parseUrlArray(record.referenceVideoUrls)).slice(0, REF_LIMITS.videos)
    const refAudios = uniqueUrls(parseUrlArray(record.referenceAudioUrls)).slice(0, REF_LIMITS.audios)
    const firstFrame = (record.firstFrameUrl || record.imageUrl || '').trim()
    const lastFrame = (record.lastFrameUrl || '').trim()

    if (refImages.length > REF_LIMITS.images) {
      throw new Error(`参考素材超限：图片≤${REF_LIMITS.images}、视频≤${REF_LIMITS.videos}、音频≤${REF_LIMITS.audios}`)
    }
    if (refVideos.length > REF_LIMITS.videos || refAudios.length > REF_LIMITS.audios) {
      throw new Error(`参考素材超限：图片≤${REF_LIMITS.images}、视频≤${REF_LIMITS.videos}、音频≤${REF_LIMITS.audios}`)
    }

    const mode = chooseMiniMaxVideoMode({
      model,
      refImages: refImages.length,
      refVideos: refVideos.length,
      refAudios: refAudios.length,
      firstFrame: Boolean(firstFrame),
      lastFrame: Boolean(lastFrame),
    })

    if (mode === 'r2va') {
      for (const url of [firstFrame, lastFrame]) {
        if (url && !refImages.includes(url) && refImages.length < REF_LIMITS.images) refImages.push(url)
      }
    }

    const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }]
    if (mode === 'i2va') {
      if (firstFrame) content.push({ type: 'image_url', image_url: { url: firstFrame }, role: 'first_frame' })
      if (lastFrame) content.push({ type: 'image_url', image_url: { url: lastFrame }, role: 'last_frame' })
    } else if (mode === 'r2va') {
      for (const url of refImages) {
        content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' })
      }
      for (const url of refVideos) {
        content.push({ type: 'video_url', video_url: { url }, role: 'reference_video' })
      }
      for (const url of refAudios) {
        content.push({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' })
      }
    }

    const body: Record<string, unknown> = {
      model,
      content,
      duration: normalizeMiniMaxDuration(record.duration, model),
      resolution: normalizeMiniMaxResolution(record.resolution, model),
    }

    if (mode === 't2va') {
      const ratio = (record.aspectRatio || '').trim()
      body.ratio = VALID_RATIOS.has(ratio) ? ratio : '16:9'
    } else if (mode === 'r2va') {
      const ratio = (record.aspectRatio || '').trim()
      if (VALID_RATIOS.has(ratio)) body.ratio = ratio
    }

    return {
      url: joinProviderUrl(config.baseUrl, '/v2', '/video_generation'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body,
    }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    const createError = providerCreateError(result)
    if (createError && !result?.task_id && !result?.task?.content?.url) {
      throw new Error(createError)
    }
    if (result.task_id) {
      return { isAsync: true, taskId: String(result.task_id) }
    }
    const videoUrl = result.task?.content?.url || result.content?.url || result.video_url
    if (videoUrl) {
      return { isAsync: false, videoUrl }
    }
    throw new Error(createError || 'No task_id or video url in response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/v2', `/query/video_generation/${taskId}`),
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    const task = result.task && typeof result.task === 'object' ? result.task : result
    const status = String(task.status || '')

    if (status === 'succeeded') {
      return {
        status: 'completed',
        videoUrl: task.content?.url || task.video_url,
      }
    }
    if (status === 'failed' || status === 'cancelled') {
      const err = task.error
      const msg = typeof err === 'string' ? err : (err?.message || JSON.stringify(err) || 'Video generation failed')
      const code = err && typeof err === 'object' && err.code ? `[${err.code}] ` : ''
      return { status: 'failed', error: annotateMiniMaxSensitiveBlock(`${code}${msg}`) }
    }
    return { status: 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    const task = result.task && typeof result.task === 'object' ? result.task : result
    return task.content?.url || task.video_url || null
  }

  extractVideoBase64(_result: any): { data: string; mimeType: string } | null {
    return null
  }
}

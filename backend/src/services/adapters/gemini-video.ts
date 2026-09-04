/**
 * Gemini Omni Flash video adapter.
 *
 * Omni uses the Interactions API (POST /v1beta/interactions), not Veo
 * generate_videos / generateContent. Drama shots map to:
 * - text_to_video when there are no images
 * - image_to_video only for a dedicated first/last frame with no refs
 * - reference_to_video for character/scene stills, including a single image
 *
 * Video generation is started with background=true and polled via
 * GET /v1beta/interactions/{id}. REST returns video bytes on
 * steps[].content[] (type=video); some proxies also fill output_video.
 */
import type {
  VideoProviderAdapter,
  ProviderRequest,
  AIConfig,
  VideoGenerationRecord,
  VideoGenResponse,
  VideoPollResponse,
} from './types.js'
import { joinProviderUrl } from './url.js'
import { parseDataUrl } from '../../utils/storage.js'

const INTERACTIONS_API_REVISION = '2026-05-20'
export const DEFAULT_OMNI_VIDEO_MODEL = 'gemini-omni-flash-preview'
const REF_IMAGE_LIMIT = 10
const IN_PROGRESS_STATUSES = new Set([
  'in_progress',
  'queued',
  'running',
  'pending',
  'processing',
])
const FAILED_STATUSES = new Set([
  'failed',
  'cancelled',
  'canceled',
  'error',
  'incomplete',
])

export function isOmniVideoModel(model: string) {
  const m = (model || '').toLowerCase()
  return m.includes('omni') && (m.includes('flash') || m.includes('preview') || m.includes('video'))
}

function parseUrlArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((u) => typeof u === 'string' && u.trim()) : []
  } catch {
    return []
  }
}

function guessImageMime(url: string) {
  const path = url.split('?')[0].toLowerCase()
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.webp')) return 'image/webp'
  if (path.endsWith('.gif')) return 'image/gif'
  return 'image/jpeg'
}

export function toOmniImageInput(raw: string) {
  const value = String(raw || '').trim()
  if (!value) return null
  const parsed = parseDataUrl(value)
  if (parsed) {
    return { type: 'image', mime_type: parsed.mimeType, data: parsed.data }
  }
  if (/^https?:\/\//i.test(value)) {
    return { type: 'image', mime_type: guessImageMime(value), uri: value }
  }
  return null
}

export function normalizeOmniDurationSeconds(duration?: number | null) {
  const parsed = Math.round(Number(duration || 5))
  if (!Number.isFinite(parsed)) return 5
  return Math.min(10, Math.max(3, parsed))
}

export function normalizeOmniAspectRatio(aspectRatio?: string | null) {
  const raw = String(aspectRatio || '').trim()
  if (raw === '9:16' || raw === '16:9') return raw
  return '16:9'
}

const REFERENCE_GUIDE =
  'Use the given image(s) as references for video generation. The images should not be used as literal initial frames.'

export function chooseOmniVideoTask(
  imageCount: number,
  opts?: { literalFirstFrame?: boolean },
) {
  if (imageCount <= 0) return 'text_to_video'
  if (opts?.literalFirstFrame) return 'image_to_video'
  return 'reference_to_video'
}

export function withOmniReferenceGuide(prompt: string, task: string) {
  if (task !== 'reference_to_video') return prompt
  if (prompt.includes('should not be used as literal initial frames')) return prompt
  return prompt ? `${prompt}\n\n${REFERENCE_GUIDE}` : REFERENCE_GUIDE
}

function collectVideoParts(node: any, depth = 0, out: any[] = []) {
  if (!node || depth > 10) return out
  if (Array.isArray(node)) {
    for (const item of node) collectVideoParts(item, depth + 1, out)
    return out
  }
  if (typeof node !== 'object') return out
  const type = String(node.type || '').toLowerCase()
  const mime = String(node.mime_type || node.mimeType || '')
  if (type === 'video' || mime.startsWith('video/')) out.push(node)
  for (const key of ['steps', 'content', 'output_video', 'outputs', 'result', 'data', 'parts']) {
    if (node[key]) collectVideoParts(node[key], depth + 1, out)
  }
  return out
}

function interactionId(result: any): string | undefined {
  const raw = result?.id || result?.task_id
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
}

function interactionPollPath(taskId: string) {
  const trimmed = String(taskId || '').replace(/^\/+/, '')
  if (trimmed.startsWith('v1beta/interactions/')) {
    return `/${trimmed.slice('v1beta/'.length)}`
  }
  if (trimmed.startsWith('interactions/')) return `/${trimmed}`
  return `/interactions/${trimmed}`
}

function geminiErrorMessage(result: any, fallback: string) {
  const err = result?.error
  if (typeof err === 'string' && err.trim()) return err
  if (err?.message) return String(err.message)
  return fallback
}

export class GeminiVideoAdapter implements VideoProviderAdapter {
  provider = 'gemini'

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest {
    const model = record.model || config.model || DEFAULT_OMNI_VIDEO_MODEL
    if (!isOmniVideoModel(model)) {
      throw new Error(`仅支持 Gemini Omni 视频模型（gemini-omni-flash-preview），当前: ${model}`)
    }

    const prompt = (record.prompt || '').trim()
    const firstFrame = (record.firstFrameUrl || record.imageUrl || '').trim()
    const lastFrame = (record.lastFrameUrl || '').trim()
    const refImages = parseUrlArray(record.referenceImageUrls)
    const imageSources = [...(firstFrame ? [firstFrame] : []), ...(lastFrame ? [lastFrame] : []), ...refImages]
      .map((item) => toOmniImageInput(item))
      .filter((item): item is NonNullable<ReturnType<typeof toOmniImageInput>> => !!item)
      .slice(0, REF_IMAGE_LIMIT)

    if (!prompt && !imageSources.length) {
      throw new Error('Gemini Omni 需要提示词或至少一张参考图')
    }

    const task = chooseOmniVideoTask(imageSources.length, {
      literalFirstFrame: Boolean(firstFrame || lastFrame) && refImages.length === 0,
    })
    const text = withOmniReferenceGuide(prompt, task)

    const input: any[] = []
    if (text) input.push({ type: 'text', text })
    input.push(...imageSources)

    const durationSec = normalizeOmniDurationSeconds(record.duration)
    const body = {
      model,
      input: input.length === 1 && input[0].type === 'text' ? text : input,
      background: true,
      generation_config: {
        video_config: {
          task,
        },
      },
      response_format: {
        type: 'video',
        aspect_ratio: normalizeOmniAspectRatio(record.aspectRatio),
        duration: `${durationSec}s`,
      },
    }

    const url = new URL(joinProviderUrl(config.baseUrl, '/v1beta', '/interactions'))
    url.searchParams.set('key', config.apiKey)

    return {
      url: url.toString(),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.apiKey,
        'Api-Revision': INTERACTIONS_API_REVISION,
      },
      body,
    }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    const status = String(result?.status || result?.state || '').toLowerCase()
    if (FAILED_STATUSES.has(status)) {
      throw new Error(geminiErrorMessage(result, `Gemini Omni generation ${status}`))
    }

    const videoUrl = this.extractVideoUrl(result)
    if (videoUrl) return { isAsync: false, videoUrl }
    if (this.extractVideoBase64(result)) return { isAsync: false }

    const id = interactionId(result)
    if (id && (!status || IN_PROGRESS_STATUSES.has(status))) {
      return { isAsync: true, taskId: id }
    }
    if (id && status === 'completed') {
      throw new Error('Gemini Omni interaction completed without video')
    }
    if (result?.error) {
      throw new Error(geminiErrorMessage(result, 'Gemini Omni generation failed'))
    }
    throw new Error('No interaction id or video in Gemini Omni response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    const url = new URL(joinProviderUrl(config.baseUrl, '/v1beta', interactionPollPath(taskId)))
    url.searchParams.set('key', config.apiKey)
    return {
      url: url.toString(),
      method: 'GET',
      headers: {
        'x-goog-api-key': config.apiKey,
        'Api-Revision': INTERACTIONS_API_REVISION,
      },
      body: undefined,
    }
  }

  /** Best-effort stop for a background Omni interaction. Vendor may ignore this. */
  buildCancelRequest(config: AIConfig, taskId: string): ProviderRequest {
    const url = new URL(joinProviderUrl(config.baseUrl, '/v1beta', `${interactionPollPath(taskId)}/cancel`))
    url.searchParams.set('key', config.apiKey)
    return {
      url: url.toString(),
      method: 'POST',
      headers: {
        'x-goog-api-key': config.apiKey,
        'Api-Revision': INTERACTIONS_API_REVISION,
      },
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    const status = String(result?.status || result?.state || '').toLowerCase()
    const videoUrl = this.extractVideoUrl(result) || undefined
    const hasVideo = Boolean(videoUrl || this.extractVideoBase64(result))

    if (FAILED_STATUSES.has(status)) {
      return { status: 'failed', error: geminiErrorMessage(result, 'Gemini Omni generation failed') }
    }
    if (hasVideo) return { status: 'completed', videoUrl }
    if (status === 'completed') {
      return { status: 'failed', error: 'Gemini Omni interaction completed without video' }
    }
    return { status: 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    for (const part of collectVideoParts(result)) {
      const uri = part.uri || part.url || part.video_url || part.file_uri
      if (typeof uri === 'string' && uri.trim()) return uri.trim()
    }
    return result?.output_video?.uri || result?.output_video?.url || result?.video_url || null
  }

  extractVideoBase64(result: any): { data: string; mimeType: string } | null {
    for (const part of collectVideoParts(result)) {
      const data = part.data || part.b64_json
      if (typeof data === 'string' && data.length > 80) {
        return {
          data,
          mimeType: part.mime_type || part.mimeType || 'video/mp4',
        }
      }
    }
    const inline = result?.output_video
    if (typeof inline?.data === 'string' && inline.data.length > 80) {
      return { data: inline.data, mimeType: inline.mime_type || inline.mimeType || 'video/mp4' }
    }
    return null
  }
}

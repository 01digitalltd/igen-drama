/**
 * Gemini image generation adapter.
 *
 * Official Gemini image models (Nano Banana / gemini-3.*-image) are generated
 * with generateContent, same as mkt-ai's GeminiImageService (@google/genai).
 * The Interactions API POST always returns an `id`; treating that as an async
 * task and polling GET /v1beta/{id} is wrong (timeout after 10 minutes).
 *
 * Poll remains implemented for in-flight Interactions jobs (resume) and any
 * response that is actually in_progress: GET /v1beta/interactions/{id}.
 */
import type {
  ImageProviderAdapter,
  ProviderRequest,
  AIConfig,
  ImageGenerationRecord,
  ImageGenResponse,
  ImagePollResponse,
} from './types'
import { joinProviderUrl } from './url'
import { parseDataUrl } from '../../utils/storage.js'

const INTERACTIONS_API_REVISION = '2026-05-20'
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

export class GeminiImageAdapter implements ImageProviderAdapter {
  provider = 'gemini'

  buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord): ProviderRequest {
    const modelName = record.model || config.model || 'gemini-3.1-flash-image'
    const model = modelName.startsWith('models/') ? modelName : `models/${modelName}`

    const parts: any[] = []
    if (record.referenceImages) {
      try {
        const refs = JSON.parse(record.referenceImages)
        for (const ref of refs) {
          const parsed = parseDataUrl(String(ref || ''))
          if (parsed) {
            parts.push({
              inline_data: {
                mime_type: parsed.mimeType,
                data: parsed.data,
              },
            })
          }
        }
      } catch {}
    }
    parts.push({ text: record.prompt || 'Generate an image' })

    const body = {
      contents: [{
        parts,
      }],
      generationConfig: {
        responseModalities: ['IMAGE', 'TEXT'],
        imageConfig: {
          aspectRatio: this.parseAspectRatio(record.size),
          imageSize: this.parseImageSize(record.size),
        },
      },
    }

    const url = new URL(joinProviderUrl(config.baseUrl, '/v1beta', `/${model}:generateContent`))
    url.searchParams.set('key', config.apiKey)

    return {
      url: url.toString(),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.apiKey,
      },
      body,
    }
  }

  parseGenerateResponse(result: any): ImageGenResponse {
    const firstCandidate = result?.candidates?.[0]
    const finishReason = firstCandidate?.finishReason || firstCandidate?.finish_reason
    const finishMessage = firstCandidate?.finishMessage || firstCandidate?.finish_message

    if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
      throw new Error(finishMessage || `Gemini generation stopped: ${finishReason}`)
    }

    if (this.extractImageUrl(result)) {
      return { isAsync: false, imageUrl: this.extractImageUrl(result) || undefined }
    }

    if (this.extractImageBase64(result)) {
      return { isAsync: false, imageUrl: undefined }
    }

    const status = String(result?.status || result?.state || '').toLowerCase()
    if (FAILED_STATUSES.has(status)) {
      throw new Error(result?.error?.message || result?.error || `Gemini generation ${status}`)
    }

    const interactionId = this.interactionId(result)
    // Interactions responses always have `id`. Only poll when Google says
    // the job is still running — never because an `id` field exists.
    if (interactionId && IN_PROGRESS_STATUSES.has(status)) {
      return { isAsync: true, taskId: interactionId }
    }

    if (result.error) {
      throw new Error(result.error.message || 'Gemini generation failed')
    }
    throw new Error('No image data in Gemini response')
  }

  parsePollResponse(result: any): ImagePollResponse {
    const status = String(result?.status || result?.state || '').toLowerCase()
    const imageUrl = this.extractImageUrl(result) || undefined
    const hasImage = Boolean(imageUrl || this.extractImageBase64(result))

    if (FAILED_STATUSES.has(status)) {
      return {
        status: 'failed',
        error: result?.error?.message || result?.error || 'Gemini generation failed',
      }
    }

    if (hasImage) {
      return { status: 'completed', imageUrl }
    }

    if (status === 'completed') {
      return { status: 'failed', error: 'Gemini interaction completed without image' }
    }

    return { status: 'processing' }
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    const url = new URL(joinProviderUrl(config.baseUrl, '/v1beta', this.interactionPollPath(taskId)))
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

  extractImageUrl(result: any): string | null {
    return result?.data?.[0]?.url
      || result?.image_url
      || result?.url
      || result?.output_image?.uri
      || result?.output_image?.url
      || null
  }

  extractImageBase64(result: any): { data: string; mimeType: string } | null {
    return findInlineImage(result)
  }

  private interactionId(result: any): string | undefined {
    const raw = result?.task_id || result?.id
    if (!raw || typeof raw !== 'string') return undefined
    return raw
  }

  private interactionPollPath(taskId: string): string {
    const trimmed = String(taskId || '').replace(/^\/+/, '')
    if (trimmed.startsWith('v1beta/interactions/')) {
      return `/${trimmed.slice('v1beta/'.length)}`
    }
    if (trimmed.startsWith('interactions/')) {
      return `/${trimmed}`
    }
    return `/interactions/${trimmed}`
  }

  private parseAspectRatio(size?: string | null): string {
    if (!size) return '16:9'
    const [w, h] = size.split('x').map(Number)
    if (!w || !h) return '16:9'
    const gcd = this.gcd(w, h)
    return `${w / gcd}:${h / gcd}`
  }

  private parseImageSize(size?: string | null): string {
    if (!size) return '1K'
    const [w] = size.split('x').map(Number)
    if (!w) return '1K'
    if (w >= 2048) return '4K'
    if (w >= 1024) return '2K'
    if (w >= 512) return '1K'
    return '512'
  }

  private gcd(a: number, b: number): number {
    return b === 0 ? a : this.gcd(b, a % b)
  }
}

function looksLikeImageBase64(data: string): boolean {
  if (typeof data !== 'string' || data.length < 80) return false
  const head = data.slice(0, 16)
  return head.startsWith('iVBORw0') || head.startsWith('/9j/') || head.startsWith('UklGR') || head.startsWith('R0lGOD')
}

function findInlineImage(node: any, depth = 0): { data: string; mimeType: string } | null {
  if (!node || depth > 8) return null

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findInlineImage(item, depth + 1)
      if (found) return found
    }
    return null
  }

  if (typeof node !== 'object') return null

  const inline = node.inlineData || node.inline_data
  if (inline?.data) {
    return {
      data: inline.data,
      mimeType: inline.mimeType || inline.mime_type || 'image/png',
    }
  }

  const mime = String(node.mime_type || node.mimeType || '')
  const rawData = node.data || node.b64_json
  const typedImage = String(node.type || '').toLowerCase() === 'image'
  if (typeof rawData === 'string' && (typedImage || mime.startsWith('image/') || looksLikeImageBase64(rawData))) {
    return { data: rawData, mimeType: mime || 'image/png' }
  }

  for (const key of ['output_image', 'candidates', 'content', 'parts', 'outputs', 'steps', 'image', 'result', 'data']) {
    if (node[key]) {
      const found = findInlineImage(node[key], depth + 1)
      if (found) return found
    }
  }
  return null
}

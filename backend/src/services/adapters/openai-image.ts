/**
 * OpenAI / APIMart image generation adapter.
 * Submit: POST /v1/images/generations
 * Poll: GET /v1/tasks/:id on APIMart, GET /v1/images/task/:id elsewhere
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

const APIMART_ASPECTS = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'])

function isApimartHost(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase().includes('apimart.ai')
  } catch {
    return /apimart\.ai/i.test(baseUrl)
  }
}

function isGptImage2Model(model: string): boolean {
  return model === 'gpt-image-2' || model.startsWith('gpt-image-2-')
}

function unwrapTaskPayload(result: any): any {
  let data = result?.data != null ? result.data : result
  if (Array.isArray(data) && data.length) data = data[0]
  if (data?.task && typeof data.task === 'object') {
    data = { ...data, ...data.task }
  }
  return data
}

function firstUrl(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstUrl(item)
      if (found) return found
    }
  }
  return null
}

export function parseOpenAiReferenceImages(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => {
      if (typeof item === 'string') return item.trim()
      if (item && typeof item === 'object') {
        return String((item as { url?: string; dataUrl?: string }).url || (item as { dataUrl?: string }).dataUrl || '').trim()
      }
      return ''
    }).filter(Boolean).slice(0, 16)
  } catch {
    return []
  }
}

function mapPixelSizeToAspect(size?: string | null): string {
  const normalized = String(size || '').trim().toLowerCase()
  if (!normalized) return '16:9'
  if (normalized === '1.91:1') return '16:9'
  if (APIMART_ASPECTS.has(normalized)) return normalized

  const known: Record<string, string> = {
    '1080x1080': '1:1',
    '1024x1024': '1:1',
    '1080x1440': '3:4',
    '1440x1080': '4:3',
    '1080x1920': '9:16',
    '1024x1536': '9:16',
    '1920x1080': '16:9',
    '1536x1024': '16:9',
    '1890x810': '21:9',
    '1920x822': '21:9',
  }
  if (known[normalized]) return known[normalized]

  const [rawWidth, rawHeight] = normalized.split('x').map(Number)
  if (!rawWidth || !rawHeight) return '16:9'
  if (rawWidth === rawHeight) return '1:1'
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const g = gcd(rawWidth, rawHeight)
  const ratio = `${rawWidth / g}:${rawHeight / g}`
  if (APIMART_ASPECTS.has(ratio)) return ratio
  return rawWidth > rawHeight ? '16:9' : '9:16'
}

export class OpenAIImageAdapter implements ImageProviderAdapter {
  provider = 'openai'

  buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord): ProviderRequest {
    const model = record.model || config.model || 'gpt-image-2'
    const isGptImage = model.startsWith('gpt-image-')
    const isGptImage2 = isGptImage2Model(model)
    const apimart = isApimartHost(config.baseUrl)
    const size = apimart && isGptImage2
      ? mapPixelSizeToAspect(record.size)
      : isGptImage2
        ? this.normalizeGptImage2Size(record.size)
        : isGptImage
          ? this.normalizeGptImageSize(record.size)
          : record.size || '1024x1024'

    const body: any = {
      model,
      prompt: record.prompt,
      size,
    }

    if (!apimart) {
      body.n = 1
    }

    if (apimart && isGptImage2) {
      body.quality = 'high'
      body.resolution = '2k'
    }

    if (!isGptImage) {
      body.response_format = 'url'
    }

    const imageUrls = parseOpenAiReferenceImages(record.referenceImages)
    if (imageUrls.length) {
      body.image_urls = imageUrls
    }

    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/images/generations'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body,
    }
  }

  private normalizeGptImageSize(size?: string | null): string {
    const allowed = ['1024x1024', '1536x1024', '1024x1536', 'auto']
    if (!size) return '1024x1024'

    const normalized = size.toLowerCase()
    if (allowed.includes(normalized)) return normalized

    const [width, height] = normalized.split('x').map(Number)
    if (!width || !height) return 'auto'
    if (width === height) return '1024x1024'
    return width > height ? '1536x1024' : '1024x1536'
  }

  private normalizeGptImage2Size(size?: string | null): string {
    if (!size) return '1024x1024'
    const normalized = size.toLowerCase()
    if (normalized === 'auto') return 'auto'

    const [rawWidth, rawHeight] = normalized.split('x').map(Number)
    if (!rawWidth || !rawHeight) return 'auto'

    const width = this.roundToMultiple(Math.min(4096, Math.max(256, rawWidth)), 16)
    const height = this.roundToMultiple(Math.min(4096, Math.max(256, rawHeight)), 16)
    return `${width}x${height}`
  }

  private roundToMultiple(value: number, multiple: number): number {
    return Math.max(multiple, Math.round(value / multiple) * multiple)
  }

  parseGenerateResponse(result: any): ImageGenResponse {
    const code = result?.code
    if (typeof code === 'number' && code !== 0 && code !== 200) {
      throw new Error(String(result?.message || result?.msg || result?.error?.message || `APIMart error ${code}`))
    }
    const imageUrl = this.extractImageUrl(result)
    if (imageUrl) {
      return { isAsync: false, imageUrl }
    }

    const data = unwrapTaskPayload(result)
    const taskId = result?.task_id || result?.taskId || data?.task_id || data?.taskId || data?.id
    if (taskId) {
      return { isAsync: true, taskId: String(taskId) }
    }

    const b64 = result?.data?.[0]?.b64_json || data?.b64_json
    if (b64) {
      return { isAsync: false, imageUrl: undefined }
    }
    throw new Error('No image URL in response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    const path = isApimartHost(config.baseUrl)
      ? `/tasks/${taskId}`
      : `/images/task/${taskId}`
    return {
      url: joinProviderUrl(config.baseUrl, '/v1', path),
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: undefined,
    }
  }

  parsePollResponse(result: any): ImagePollResponse {
    const data = unwrapTaskPayload(result)
    const raw = String(data?.status || result?.status || '').trim().toLowerCase()
    const status = this.normalizePollStatus(raw)
    if (status === 'completed') {
      const imageUrl = this.extractImageUrl(result)
      if (imageUrl) return { status: 'completed', imageUrl }
      return { status: 'failed', error: 'Task completed without image URL' }
    }
    if (status === 'failed') {
      const err = data?.error
      const message = typeof err === 'string'
        ? err
        : err?.message || data?.message || result?.error?.message || 'Generation failed'
      return { status: 'failed', error: message }
    }
    return { status }
  }

  private normalizePollStatus(raw: string): ImagePollResponse['status'] {
    if (raw === 'completed' || raw === 'succeeded' || raw === 'success' || raw === 'done') {
      return 'completed'
    }
    if (raw === 'failed' || raw === 'error' || raw === 'cancelled' || raw === 'canceled') {
      return 'failed'
    }
    if (
      raw === 'pending'
      || raw === 'submitted'
      || raw === 'queued'
      || raw === 'waiting'
      || raw === 'accepted'
    ) {
      return 'pending'
    }
    return 'processing'
  }

  extractImageUrl(result: any): string | null {
    const data = unwrapTaskPayload(result)
    const nested = data?.result
    const images = Array.isArray(nested?.images)
      ? nested.images
      : nested?.image != null
        ? [nested.image]
        : []
    for (const img of images) {
      const found = firstUrl(img?.url)
      if (found) return found
    }
    return firstUrl(result?.data?.[0]?.url)
      || firstUrl(result?.image_url)
      || firstUrl(data?.image_url)
      || firstUrl(data?.url)
      || null
  }

  extractImageBase64(result: any): { data: string; mimeType: string } | null {
    const b64 = result.data?.[0]?.b64_json
    if (b64) {
      return { data: b64, mimeType: 'image/png' }
    }
    return null
  }
}

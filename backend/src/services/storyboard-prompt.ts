import { clipDurationBounds } from './video-clip-policy.js'

/**
 * Video generation prefers a dedicated video_prompt. Storyboard breakdown
 * writes description (and atmosphere) instead, so empty video_prompt must
 * fall back to that shot text — MiniMax H3 requires text, and Gemini Omni
 * otherwise image-to-videos with no shot action.
 */
export function resolveStoryboardVideoPrompt(shot: {
  videoPrompt?: string | null
  video_prompt?: string | null
  description?: string | null
  atmosphere?: string | null
}): string {
  const dedicated = String(shot.videoPrompt || shot.video_prompt || '').trim()
  if (dedicated) return dedicated
  const description = String(shot.description || '').trim()
  const atmosphere = String(shot.atmosphere || '').trim()
  if (description && atmosphere) return `${description}\n\n${atmosphere}`
  return description || atmosphere
}

export function parseVideoPromptDurationSeconds(prompt?: string | null): number | null {
  const text = String(prompt || '')
  let maxEnd = 0
  const rangeRe = /(\d+)\s*[-–~—]\s*(\d+)\s*(?:秒|s)(?=$|[^\d])/gi
  let match: RegExpExecArray | null
  while ((match = rangeRe.exec(text))) {
    const end = Number(match[2])
    if (Number.isFinite(end) && end > maxEnd) maxEnd = end
  }
  return maxEnd > 0 ? maxEnd : null
}

export function rewriteSeedancePromptRefs(prompt: string) {
  return String(prompt || '').replace(/<IMAGE_REF_(\d+)>/g, (_m, n) => `@图片${Number(n) + 1}`)
}

export type ShotImageRef = {
  index: number
  tag: string
  kind: 'scene' | 'character' | 'prop'
  name: string
}

const OMNI_REF_LIMIT = 10

/** Same order as generation: scene still, then character stills, then prop stills. */
export function buildShotImageRefs(opts: {
  scene?: { location?: string | null; imageUrl?: string | null; image_url?: string | null } | null
  characters?: Array<{ name?: string | null; imageUrl?: string | null; image_url?: string | null }>
  props?: Array<{ name?: string | null; imageUrl?: string | null; image_url?: string | null }>
}): ShotImageRef[] {
  const ordered: ShotImageRef[] = []
  const seen = new Set<string>()
  const push = (kind: ShotImageRef['kind'], name: string, url?: string | null) => {
    const image = String(url || '').trim()
    if (!image || seen.has(image) || ordered.length >= OMNI_REF_LIMIT) return
    seen.add(image)
    const index = ordered.length
    ordered.push({
      index,
      tag: `<IMAGE_REF_${index}>`,
      kind,
      name: String(name || '').trim(),
    })
  }
  const scene = opts.scene
  push('scene', scene?.location || '', scene?.imageUrl || scene?.image_url)
  for (const character of opts.characters || []) {
    push('character', character.name || '', character.imageUrl || character.image_url)
  }
  for (const prop of opts.props || []) {
    push('prop', prop.name || '', prop.imageUrl || prop.image_url)
  }
  return ordered
}

export function resolveVideoGenerationDuration(opts: {
  prompt?: string | null
  shotDuration?: number | null
  provider?: string | null
  model?: string | null
}): number {
  const bounds = clipDurationBounds(opts.provider, opts.model)
  const parsed = parseVideoPromptDurationSeconds(opts.prompt)
  const raw = parsed ?? Number(opts.shotDuration)
  const n = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 10
  return Math.min(bounds.max, Math.max(bounds.min, n))
}

/** Per-model clip length for storyboard split, prompts, and generation. */

export type ClipDurationPolicy = {
  min: number
  max: number
  typical: number
  promptSegment: number
}

export const DIALOGUE_CHARS_PER_SECOND = 4.5
export const DIALOGUE_ACTING_PADDING_SECONDS = 2

export const GEMINI_OMNI_VIDEO_MODELS = ['gemini-omni-1.1-flash', 'gemini-omni-flash-preview'] as const

export function parseConfigModels(raw: unknown): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map((item) => String(item || '').trim()).filter(Boolean)
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) return parsed.map((item) => String(item || '').trim()).filter(Boolean)
    } catch {
      /* raw model id */
    }
    return raw.trim() ? [raw.trim()] : []
  }
  return []
}

export function firstConfigModel(raw: unknown): string {
  return parseConfigModels(raw)[0] || ''
}

/** Always offer Omni 1.1 on Gemini video configs, even if DB still lists preview only. */
export function expandGeminiOmniVideoModels(provider?: string | null, models: string[] = []): string[] {
  const p = String(provider || '').toLowerCase()
  const list = models.map((item) => String(item || '').trim()).filter(Boolean)
  if (p !== 'gemini' && !list.some((item) => item.toLowerCase().includes('omni'))) return list
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of [...GEMINI_OMNI_VIDEO_MODELS, ...list]) {
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

export function isOmniVideoConfig(provider?: string | null, model?: string | null) {
  const p = String(provider || '').toLowerCase()
  const m = String(model || '').toLowerCase()
  return p === 'gemini' || m.includes('omni')
}

/** Which video-prompt SKILL the agent should follow for this clip. */
export function promptSkillForVideo(provider?: string | null, model?: string | null): 'omni' | 'seedance' {
  return isOmniVideoConfig(provider, model) ? 'omni' : 'seedance'
}

export function clipDurationBounds(provider?: string | null, model?: string | null): ClipDurationPolicy {
  const p = String(provider || '').toLowerCase()
  const m = String(model || '').toLowerCase()
  if (isOmniVideoConfig(p, m)) {
    return { min: 3, max: 10, typical: 8, promptSegment: 3 }
  }
  if (p === 'minimax' || m.includes('minimax')) {
    if (m.includes('h3-max')) return { min: 5, max: 15, typical: 12, promptSegment: 3 }
    return { min: 4, max: 15, typical: 12, promptSegment: 3 }
  }
  return { min: 4, max: 15, typical: 12, promptSegment: 3 }
}

export function clampShotDurationForModel(
  value: number | null | undefined,
  bounds: ClipDurationPolicy,
  fallback = 10,
) {
  const n = Number(value)
  const raw = Number.isFinite(n) && n > 0 ? Math.round(n) : fallback
  return Math.min(bounds.max, Math.max(bounds.min, raw))
}

export function durationExceedsMax(seconds: number | null | undefined, max: number) {
  const n = Number(seconds)
  return Number.isFinite(n) && n > max
}

export function estimatedShotCount(targetSeconds: number, typical: number) {
  const shot = Math.max(1, Math.round(Number(typical) || 10))
  const target = Math.max(shot, Math.round(Number(targetSeconds) || 0))
  const mid = Math.max(1, Math.round(target / shot))
  return {
    typical: mid,
    min: Math.max(1, Math.floor(mid * 0.8)),
    max: Math.max(mid, Math.ceil(mid * 1.2)),
  }
}

export function dialogueFloorSeconds(charCount: number) {
  const n = Math.max(0, Number(charCount) || 0)
  return Math.ceil(n / DIALOGUE_CHARS_PER_SECOND) + DIALOGUE_ACTING_PADDING_SECONDS
}

export function clampDialogueFloor(charCount: number, bounds: ClipDurationPolicy) {
  return Math.min(bounds.max, Math.max(bounds.min, dialogueFloorSeconds(charCount)))
}

export function promptExceedsModelMessage(seconds: number, max: number) {
  return `视频提示词时间轴为 ${seconds}s，超过当前模型上限 ${max}s，请先重产提示词或改选模型`
}

export function shotExceedsModelMessage(seconds: number, max: number) {
  return `分镜时长为 ${seconds}s，超过当前模型上限 ${max}s，请先重拆分镜或改选模型`
}

export function assertClipSecondsFit(
  seconds: number | null | undefined,
  bounds: ClipDurationPolicy,
  kind: 'prompt' | 'shot',
) {
  if (seconds == null) return
  const n = Number(seconds)
  if (!Number.isFinite(n) || n <= bounds.max) return
  throw new Error(kind === 'prompt' ? promptExceedsModelMessage(n, bounds.max) : shotExceedsModelMessage(n, bounds.max))
}

export function toAgentVideoGeneration(opts: {
  provider?: string | null
  model?: string | null
  configId?: number | null
  bounds: ClipDurationPolicy
  targetDurationSeconds?: number | null
}) {
  const counts = opts.targetDurationSeconds
    ? estimatedShotCount(opts.targetDurationSeconds, opts.bounds.typical)
    : null
  return {
    provider: opts.provider || '',
    model: opts.model || '',
    config_id: opts.configId || null,
    duration_min: opts.bounds.min,
    duration_max: opts.bounds.max,
    typical_shot: opts.bounds.typical,
    prompt_segment: opts.bounds.promptSegment,
    prompt_skill: promptSkillForVideo(opts.provider, opts.model),
    target_duration_seconds: opts.targetDurationSeconds || null,
    estimated_shot_count: counts,
    dialogue_chars_per_second: DIALOGUE_CHARS_PER_SECOND,
    acting_padding_seconds: DIALOGUE_ACTING_PADDING_SECONDS,
  }
}

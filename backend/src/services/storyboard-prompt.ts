import { visualStyleLabel, normalizeStyleValue } from './style-preset.js'
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
  kind: 'scene' | 'character' | 'prop' | 'continuity'
  name: string
  url: string
}

const OMNI_REF_LIMIT = 10

function assetStillUrl(asset?: {
  imageUrl?: string | null
  image_url?: string | null
  localPath?: string | null
  local_path?: string | null
} | null) {
  return String(asset?.imageUrl || asset?.image_url || asset?.localPath || asset?.local_path || '').trim()
}

const REF_KIND_LABEL: Record<ShotImageRef['kind'], string> = {
  scene: '场景空镜',
  character: '角色设定',
  prop: '道具单品',
  continuity: '本片已生成分镜',
}

/** Same order as generation: scene still, then character stills, then prop stills. */
export function buildShotImageRefs(opts: {
  scene?: {
    location?: string | null
    imageUrl?: string | null
    image_url?: string | null
    localPath?: string | null
    local_path?: string | null
  } | null
  characters?: Array<{
    name?: string | null
    imageUrl?: string | null
    image_url?: string | null
    localPath?: string | null
    local_path?: string | null
  }>
  props?: Array<{
    name?: string | null
    imageUrl?: string | null
    image_url?: string | null
    localPath?: string | null
    local_path?: string | null
  }>
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
      url: image,
    })
  }
  const scene = opts.scene
  push('scene', scene?.location || '', assetStillUrl(scene))
  for (const character of opts.characters || []) {
    push('character', character.name || '', assetStillUrl(character))
  }
  for (const prop of opts.props || []) {
    push('prop', prop.name || '', assetStillUrl(prop))
  }
  return ordered
}

export function geminiImageOrdinal(index: number) {
  const digits = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  return `第${digits[index] || String(index + 1)}张图`
}

export function geminiStillCaption(ref: Pick<ShotImageRef, 'kind' | 'name'>, index: number) {
  const ordinal = geminiImageOrdinal(index)
  const label = REF_KIND_LABEL[ref.kind]
  const name = String(ref.name || '').trim() || label
  if (ref.kind === 'character') {
    return `${ordinal}是角色设定（${name}）。必须用这张图里的同一张脸、发型与服装，禁止换人换脸。`
  }
  if (ref.kind === 'scene') {
    return `${ordinal}是场景空镜（${name}）。只用这张图的空间与陈设，把人物放进这个空间。`
  }
  if (ref.kind === 'continuity') {
    return `${ordinal}是本片已生成的分镜静帧（${name}）。必须保持同一部短片的画风、色温、镜头质感、服装与发型；只改这一镜的动作、景别与机位，不要换成另一部电影。`
  }
  return `${ordinal}是道具（${name}）。保留这张图的包装、Logo 与比例。`
}

export function filmContinuityLine(styleValue?: string | null) {
  const style = visualStyleLabel(styleValue)
  const chibi = normalizeStyleValue(styleValue) === '3d'
    ? '人物头身比约 1:2、头大身小、四肢短圆、盲盒风三维，场景与道具也是同款圆润卡通三维，禁止真人照片与电影质感。'
    : ''
  return [
    '这是同一部短片里的一镜，不是另一部影片或独立插画。',
    style ? `全片保持${style}。` : '',
    chibi,
    '同一色温、镜头质感、服装与发型；禁止换脸换装、另造空间或改成另一种媒介。',
  ].filter(Boolean).join('')
}

/** Prefer the nearest earlier composed still so later shots lock to the same film. */
export function pickPreviousStoryboardStill<T extends {
  id: number
  storyboardNumber?: number | null
  deletedAt?: unknown
  composedImage?: string | null
  firstFrameImage?: string | null
}>(current: T, rows: T[]): T | null {
  const withStill = rows.filter((row) => {
    if (row.id === current.id || row.deletedAt) return false
    return Boolean(String(row.composedImage || row.firstFrameImage || '').trim())
  })
  if (!withStill.length) return null
  const currentNo = Number(current.storyboardNumber) || 0
  const previous = withStill
    .filter((row) => (Number(row.storyboardNumber) || 0) < currentNo)
    .sort((a, b) => (Number(b.storyboardNumber) || 0) - (Number(a.storyboardNumber) || 0))[0]
  if (previous) return previous
  return [...withStill].sort((a, b) => (Number(a.storyboardNumber) || 0) - (Number(b.storyboardNumber) || 0))[0] || null
}

export function storyboardStillRefLine(ref: ShotImageRef) {
  return geminiStillCaption(ref, ref.index)
}

/** Prefix so Gemini maps attached parts[0..] to 第一张图 / 第二张图. */
export function lockStoryboardStillPrompt(prompt: string, refs: ShotImageRef[], styleValue?: string | null) {
  const body = String(prompt || '').trim()
  const film = filmContinuityLine(styleValue)
  if (!refs.length) {
    if (!body) return film
    if (body.includes('同一部短片')) return body
    return [film, body].filter(Boolean).join('')
  }
  if (refs.every((ref) => body.includes(geminiImageOrdinal(ref.index)))) {
    return body.includes('同一部短片') ? body : [film, body].filter(Boolean).join('')
  }
  return [
    film,
    '根据前面按顺序附上的参考图做图生图合成，必须使用这些图像素，不要重新发明脸或产品外观。',
    ...refs.map((ref, index) => geminiStillCaption(ref, index)),
    body,
  ].filter(Boolean).join('')
}

export function firstStoryboardBeat(description?: string | null): string {
  const text = String(description || '').trim()
  if (!text) return ''
  const beats = [...text.matchAll(/【镜头\s*\d+】\s*([\s\S]*?)(?=【镜头\s*\d+】|$)/g)]
    .map((match) => String(match[1] || '').replace(/(?:女声|男声)?旁白[：:].*$/s, '').trim())
    .filter(Boolean)
  if (beats[0]) return beats[0]
  return text.replace(/(?:女声|男声)?旁白[：:].*$/s, '').trim()
}

export function composeStoryboardImagePrompt(opts: {
  description?: string | null
  atmosphere?: string | null
  imageRefs?: ShotImageRef[]
  styleValue?: string | null
}): string {
  const beat = firstStoryboardBeat(opts.description)
  const refs = opts.imageRefs || []
  const lock = refs.length
    ? [
        '根据前面按顺序附上的参考图做图生图合成。',
        ...refs.map((ref, index) => geminiStillCaption(ref, index)),
      ].join('')
    : '按画面描述绘制，不要发明无关角色。'
  const style = visualStyleLabel(opts.styleValue)
  const atmosphere = String(opts.atmosphere || '').trim()
  return [
    filmContinuityLine(opts.styleValue),
    `单帧分镜静帧，16:9 横图${style ? `，${style}` : ''}。`,
    normalizeStyleValue(opts.styleValue) === '3d' ? '头身比约 1:2 的 3D Chibi 盲盒风三维，光滑树脂，禁止电影质感真人。' : '',
    lock,
    beat,
    atmosphere ? `氛围光线：${atmosphere}。` : '',
    '不要时间轴、不要配音旁白、不要字幕文字。',
  ].filter(Boolean).join('')
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

import { applyHandheldViewpoint } from './handheld-viewpoint.js'
import { visualStyleLabel, normalizeStyleValue } from './style-preset.js'
import { clipDurationBounds, DIALOGUE_CHARS_PER_SECOND } from './video-clip-policy.js'
import { isXaiVideoConfig } from './video-model-policy.js'
import { extractSpokenLines } from './tts/vo-speech.js'

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

const SHOT_MARKER = '【[镜鏡][头頭]\\s*\\d+】'

/** A cut with no line still needs a moment. A cut that speaks needs longer. */
export const MIN_SILENT_BEAT_SECONDS = 2
export const MIN_SPOKEN_BEAT_SECONDS = 3

export type InnerShotOverflow = {
  beats: number
  spoken: number
  needed: number
}

/** Seconds one 【镜头N】 needs. Speech time stacks; a spoken cut is never under 3s. */
export function innerBeatSeconds(beat: string, charsPerSecond = DIALOGUE_CHARS_PER_SECOND): number {
  const lines = extractSpokenLines(beat)
  if (!lines.length) return MIN_SILENT_BEAT_SECONDS
  const chars = lines.reduce((sum, line) => sum + line.text.replace(/\s/g, '').length, 0)
  const speech = Math.ceil(chars / charsPerSecond)
  return Math.max(MIN_SPOKEN_BEAT_SECONDS, speech)
}

function spokenLineSeconds(text: string, charsPerSecond: number): number {
  const chars = text.replace(/\s/g, '').length
  return Math.max(MIN_SPOKEN_BEAT_SECONDS, Math.ceil(chars / charsPerSecond))
}

export type BeatTimeBudget = {
  charsPerSecond?: number
  /** Extra seconds after the last spoken line, used by xAI. */
  tailSeconds?: number
}

/** Seconds the cuts in one storyboard need. Several spoken lines each take their own time. */
export function innerShotSecondsNeeded(description?: string | null, budget?: BeatTimeBudget): number {
  const charsPerSecond = budget?.charsPerSecond && budget.charsPerSecond > 0
    ? budget.charsPerSecond
    : DIALOGUE_CHARS_PER_SECOND
  const beats = storyboardBeats(description)
  const lines = extractSpokenLines(String(description || ''))
  const fromBeats = beats.length >= 2
    ? beats.reduce((sum, beat) => sum + innerBeatSeconds(beat, charsPerSecond), 0)
    : 0
  const fromLines = lines.length >= 2
    ? lines.reduce((sum, line) => sum + spokenLineSeconds(line.text, charsPerSecond), 0)
    : 0
  const needed = Math.max(fromBeats, fromLines)
  if (!needed || !lines.length) return needed
  return needed + Math.max(0, Math.round(Number(budget?.tailSeconds) || 0))
}

/**
 * Reject a storyboard whose cuts cannot play inside its duration.
 * One short line in an unmarked description is left alone.
 */
export function innerShotsOverflow(
  description: string | null | undefined,
  duration: number,
  budget?: BeatTimeBudget,
): InnerShotOverflow | null {
  const needed = innerShotSecondsNeeded(description, budget)
  if (needed <= 0) return null
  const seconds = Math.max(0, Math.round(Number(duration) || 0))
  if (needed <= seconds) return null
  const beats = storyboardBeats(description)
  const lines = extractSpokenLines(String(description || ''))
  const cuts = Math.max(beats.length >= 2 ? beats.length : 0, lines.length >= 2 ? lines.length : 0)
  return { beats: cuts, spoken: lines.length, needed }
}

export function formatInnerShotOverflow(
  rows: Array<{ shotNumber: number; duration: number } & InnerShotOverflow>,
  durationMax?: number,
) {
  const detail = rows.map((row) => {
    const spoken = row.spoken ? `，其中 ${row.spoken} 个有对白` : ''
    const cap = durationMax && row.needed <= durationMax
      ? `把这段 duration 改成 ${row.needed} 秒，镜头2、镜头3留在这一段`
      : `这段加到 ${durationMax || 'duration_max'} 秒仍不够，才把多出来的镜头拆到下一个分镜`
    return `#${row.shotNumber} 只有 ${row.duration} 秒，却有 ${row.beats} 个镜头${spoken}，至少要 ${row.needed} 秒。${cap}`
  }).join('；')
  const ceiling = durationMax ? `${durationMax} 秒` : 'duration_max'
  return `镜头装不下：${detail}。先加长该分镜的 duration，不得超过 ${ceiling}。不要拆成每段只有镜头1。没对白的镜头至少 ${MIN_SILENT_BEAT_SECONDS} 秒，有对白的镜头至少 ${MIN_SPOKEN_BEAT_SECONDS} 秒并够把那句说完。总时长仍不得超过目标秒数。然后重新调用 save_storyboards，第一批 replace_existing: true。`
}

/** Sub-shots in order. Accepts both 【镜头1】 and 【鏡頭1】. */
export function storyboardBeats(description?: string | null): string[] {
  const text = String(description || '').trim()
  if (!text) return []
  const re = new RegExp(`${SHOT_MARKER}\\s*([\\s\\S]*?)(?=${SHOT_MARKER}|$)`, 'g')
  return [...text.matchAll(re)]
    .map((match) => String(match[1] || '').trim())
    .filter(Boolean)
}

/** Opening and ending beats used to bridge one generated clip into the next. */
export function shotContinuityCue(description?: string | null, result?: string | null) {
  const text = String(description || '').replace(/\s+/g, ' ').trim()
  const beats = storyboardBeats(text)
  const opening = (beats[0] || text).slice(0, 180)
  const ending = (String(result || '').trim() || beats[beats.length - 1] || text).slice(0, 180)
  return { opening, ending }
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
  /** Extra labels, such as a character role, used to match shot 1. */
  aliases?: string[]
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
    role?: string | null
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
  const push = (kind: ShotImageRef['kind'], name: string, url?: string | null, aliases?: Array<string | null | undefined>) => {
    const image = String(url || '').trim()
    if (!image || seen.has(image) || ordered.length >= OMNI_REF_LIMIT) return
    seen.add(image)
    const index = ordered.length
    const labels = (aliases || []).map((item) => String(item || '').trim()).filter((item) => item.length >= 2)
    ordered.push({
      index,
      tag: `<IMAGE_REF_${index}>`,
      kind,
      name: String(name || '').trim(),
      url: image,
      ...(labels.length ? { aliases: labels } : {}),
    })
  }
  const scene = opts.scene
  push('scene', scene?.location || '', assetStillUrl(scene))
  for (const character of opts.characters || []) {
    push('character', character.name || '', assetStillUrl(character), [character.role])
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

export function geminiStillCaption(
  ref: Pick<ShotImageRef, 'kind' | 'name'>,
  index: number,
  opts?: { openingFrame?: boolean },
) {
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
    const base = `${ordinal}是本片已生成的分镜静帧（${name}）。必须保持同一部短片的画风、色温、镜头质感、服装与发型；`
    if (opts?.openingFrame) {
      return `${base}这一镜的地点、动作和构图以镜头 1 为准，不要复制这张图的场景。`
    }
    return `${base}只改这一镜的动作、景别与机位，不要换成另一部电影。`
  }
  return `${ordinal}是道具（${name}）。保留这张图的包装、Logo 与比例。`
}

export function filmContinuityLine(styleValue?: string | null, opts?: { allowShotPlace?: boolean }) {
  const style = visualStyleLabel(styleValue)
  const chibi = normalizeStyleValue(styleValue) === '3d'
    ? '人物头身比约 1:2、头大身小、四肢短圆、盲盒风三维，场景与道具也是同款圆润卡通三维，禁止真人照片与电影质感。'
    : ''
  const place = opts?.allowShotPlace
    ? '同一色温、镜头质感、服装与发型；禁止换脸换装或改成另一种媒介。'
    : '同一色温、镜头质感、服装与发型；禁止换脸换装、另造空间或改成另一种媒介。'
  return [
    '这是同一部短片里的一镜，不是另一部影片或独立插画。',
    style ? `全片保持${style}。` : '',
    chibi,
    place,
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

const BRAND_LOGO_NAME = '品牌Logo'

const OPENING_FRAME_MARKER = /\[OPENING_FRAME:\s*use_scene=(true|false);\s*names=([^\]]*)\]/i

/** The storyboard-image skill decides this. Code only attaches the chosen files. */
export type OpeningFrameChoice = {
  useScene: boolean
  names: string[]
}

export function formatOpeningFrameChoice(choice: OpeningFrameChoice) {
  const names = choice.names.map((name) => name.replace(/[|\]]/g, ' ').trim()).filter(Boolean)
  return `[OPENING_FRAME: use_scene=${choice.useScene ? 'true' : 'false'}; names=${names.join('|')}]`
}

export function openingFrameChoiceFromPayload(payload: unknown): OpeningFrameChoice | null {
  if (!payload || typeof payload !== 'object') return null
  const row = payload as Record<string, unknown>
  const raw = row.opening_frame ?? row.openingFrame
  if (!raw || typeof raw !== 'object') return null
  const frame = raw as Record<string, unknown>
  const useScene = frame.use_scene ?? frame.useScene
  if (typeof useScene !== 'boolean') return null
  const namesRaw = frame.names
  const names = Array.isArray(namesRaw)
    ? namesRaw.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  return { useScene, names }
}

export function parseOpeningFrameChoice(text?: string | null): OpeningFrameChoice | null {
  const match = String(text || '').match(OPENING_FRAME_MARKER)
  if (!match) return null
  return {
    useScene: match[1].toLowerCase() === 'true',
    names: match[2].split('|').map((name) => name.trim()).filter(Boolean),
  }
}

function refLabels(ref: Pick<ShotImageRef, 'name' | 'aliases'>) {
  return [ref.name, ...(ref.aliases || [])].map((item) => String(item || '').trim()).filter((item) => item.length >= 2)
}

/** A label counts when the text contains it, or a 2+ character suffix of it (陳師傅 ↔ 師傅). */
function textMentions(text: string, labels: string[]) {
  for (const name of labels) {
    if (text.includes(name)) return true
    for (let start = 1; start <= name.length - 2; start++) {
      if (text.includes(name.slice(start))) return true
    }
  }
  return false
}

function shotShowsPerson(beat: string) {
  return /女主角|男主角|主角|主持人|博主|她|他|對(?:著|着)?鏡頭|对(?:着|著)?镜头|看(?:著|着)(?:鏡頭|镜头)|自拍|說|说/u.test(beat)
}

function choiceSelects(names: string[], labels: string[]) {
  const wanted = new Set(names.map((name) => name.trim()).filter(Boolean))
  return labels.some((label) => wanted.has(label))
}

function openingAtmosphere(raw: string) {
  const text = String(raw || '').trim()
  if (!text) return ''
  const cut = text.split(/(?:隨後|随后|然後|然后|後來|后来|之後|之后)/)[0].replace(/[，,。；;]\s*$/, '').trim()
  if (!cut) return ''
  return `镜头 1 刚开始时的光线：${cut}。不要把镜头 1 后半段或后面镜头的情绪画进这一帧。`
}

/**
 * Frame 0 attaches the files the storyboard-image skill selected.
 * Without that selection, a later-shot name stays off and the scene stays
 * unless its name appears only after shot 1. Place words are not listed here.
 */
export function openingFrameRefs(
  description?: string | null,
  refs: ShotImageRef[] = [],
  choice?: OpeningFrameChoice | null,
): ShotImageRef[] {
  const beats = storyboardBeats(description)
  const beat = firstStoryboardBeat(description)
  const later = beats.slice(1).join('\n')
  const kept: ShotImageRef[] = []
  const unknownCharacters: ShotImageRef[] = []
  for (const ref of refs) {
    if (ref.kind === 'continuity') continue
    const labels = refLabels(ref)
    if (choice) {
      if (ref.kind === 'scene') {
        if (choice.useScene) kept.push(ref)
        continue
      }
      if (ref.kind === 'prop' && ref.name === BRAND_LOGO_NAME) {
        kept.push(ref)
        continue
      }
      if (choiceSelects(choice.names, labels)) kept.push(ref)
      continue
    }
    if (ref.kind === 'character') {
      if (textMentions(beat, labels)) kept.push(ref)
      else if (!textMentions(later, labels)) unknownCharacters.push(ref)
      continue
    }
    if (ref.kind === 'prop') {
      if (ref.name === BRAND_LOGO_NAME || textMentions(beat, labels)) kept.push(ref)
      continue
    }
    if (ref.kind === 'scene' && !textMentions(later, labels)) kept.push(ref)
  }
  const namedCharacter = kept.some((ref) => ref.kind === 'character')
  if (!namedCharacter && shotShowsPerson(beat) && unknownCharacters.length === 1) {
    kept.push(unknownCharacters[0])
  }
  // A previous still is another shot. Once the skill picked frame 0's files,
  // attaching it makes Gemini redraw that shot instead of this 镜头1.
  const continuity = choice ? [] : refs.filter((ref) => ref.kind === 'continuity')
  const order: Record<ShotImageRef['kind'], number> = { scene: 0, character: 1, prop: 2, continuity: 3 }
  return [...kept, ...continuity]
    .sort((a, b) => order[a.kind] - order[b.kind])
    .map((ref, index) => ({ ...ref, index, tag: `<IMAGE_REF_${index}>` }))
}

export function firstStoryboardBeat(description?: string | null): string {
  const text = String(description || '').trim()
  if (!text) return ''
  const beats = storyboardBeats(text)
    .map((beat) => beat.replace(/(?:女声|男声)?旁白[：:].*$/s, '').trim())
    .filter(Boolean)
  if (beats[0]) return beats[0]
  return text.replace(/(?:女声|男声)?旁白[：:].*$/s, '').trim()
}

export function composeStoryboardImagePrompt(opts: {
  description?: string | null
  atmosphere?: string | null
  imageRefs?: ShotImageRef[]
  styleValue?: string | null
  onScreenText?: string | null
  openingFrame?: OpeningFrameChoice | null
}): string {
  const beat = firstStoryboardBeat(opts.description)
  const refs = openingFrameRefs(opts.description, opts.imageRefs || [], opts.openingFrame)
  const sceneLocked = refs.some((ref) => ref.kind === 'scene')
  const lock = refs.length
    ? [
        '根据前面按顺序附上的参考图做图生图合成。',
        ...refs.map((ref, index) => geminiStillCaption(ref, index, { openingFrame: true })),
      ].join('')
    : '按画面描述绘制，不要发明无关角色。'
  const style = visualStyleLabel(opts.styleValue)
  const atmosphere = openingAtmosphere(String(opts.atmosphere || ''))
  const onScreenText = String(opts.onScreenText || '').trim()
  return applyHandheldViewpoint([
    filmContinuityLine(opts.styleValue, { allowShotPlace: !sceneLocked }),
    `这是这段影片的第 0 帧，只画镜头 1 动作刚开始的瞬间${style ? `，${style}` : ''}。画幅跟项目。不要画镜头 2 及之后。`,
    '镜头 1 如果有好几句，只画第一眼：人刚入画、动作还没做完。后半句的结果不要画成已经发生。',
    sceneLocked ? '' : '这一帧的地点只跟镜头 1。没有附上场景图时，不要改画成这段后面镜头的房间。',
    normalizeStyleValue(opts.styleValue) === '3d' ? '头身比约 1:2 的 3D Chibi 盲盒风三维，光滑树脂，禁止电影质感真人。' : '',
    lock,
    beat,
    atmosphere ? `${atmosphere}` : '',
    '不要时间轴、不要配音旁白、不要把对白烧成字幕。',
    onScreenText,
  ].filter(Boolean).join(''), beat, { openingFrame: true })
}

export function resolveVideoGenerationDuration(opts: {
  prompt?: string | null
  shotDuration?: number | null
  provider?: string | null
  model?: string | null
}): number {
  const bounds = clipDurationBounds(opts.provider, opts.model)
  const parsed = parseVideoPromptDurationSeconds(opts.prompt)
  const shot = Number(opts.shotDuration)
  const shotOk = Number.isFinite(shot) && shot > 0
  // xAI clips follow the storyboard seconds. A longer timeline in the prompt
  // must not stretch the video past that field.
  const raw = isXaiVideoConfig(opts.provider, opts.model) && shotOk
    ? shot
    : (parsed ?? (shotOk ? shot : NaN))
  const n = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 10
  return Math.min(bounds.max, Math.max(bounds.min, n))
}

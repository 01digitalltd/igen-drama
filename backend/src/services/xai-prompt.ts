import type { ShotImageRef } from './storyboard-prompt.js'
import { extractSpokenLines } from './tts/vo-speech.js'

const KIND_RANK: Record<ShotImageRef['kind'], number> = {
  character: 0,
  scene: 1,
  prop: 2,
  continuity: 3,
}

/** Characters first, then the location, then props. Drop continuity stills. */
export function orderXaiImageRefs(refs: ShotImageRef[]): ShotImageRef[] {
  return [...refs]
    .filter((ref) => ref.kind !== 'continuity' && String(ref.url || '').trim())
    .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind])
    .slice(0, 7)
    .map((ref, index) => ({
      ...ref,
      index,
      tag: `<IMAGE_${index}>`,
    }))
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Point stored prompts at the reference_images array xAI actually receives.
 * `<IMAGE_REF_N>` follows the original still order; `@名字` follows the asset name.
 */
export function rewriteXaiPrompt(
  prompt: string,
  ordered: Array<Pick<ShotImageRef, 'name' | 'index' | 'url'> & { sourceUrl?: string }>,
  sourceOrder: Array<Pick<ShotImageRef, 'index' | 'url'>> = [],
) {
  let text = String(prompt || '')
    .replace(/\n\n\[VO_AUDIO_REFS:[\s\S]*?(?=\n\n\[|$)/gu, '')
    .replace(/\n\n\[AUDIO: Speak only[\s\S]*?\]/gu, '')
    .trim()
  const indexByUrl = new Map(ordered.map((ref) => [ref.sourceUrl || ref.url, ref.index]))
  text = text.replace(/<IMAGE_REF_(\d+)>/g, (token, raw) => {
    const source = sourceOrder.find((ref) => ref.index === Number(raw))
    if (!source) return token
    const next = indexByUrl.get(source.url)
    return next == null ? token : `<IMAGE_${next}>`
  })
  const named = [...ordered]
    .filter((ref) => String(ref.name || '').trim())
    .sort((a, b) => String(b.name).length - String(a.name).length)
  for (const ref of named) {
    text = text.replace(new RegExp(`@${escapeRegExp(String(ref.name).trim())}`, 'g'), `<IMAGE_${ref.index}>`)
  }
  return text
}

const XAI_DURATION_MAX = 15
const XAI_SPEECH_TAIL_SECONDS = 1
const XAI_CJK_CHARS_PER_SECOND = 2.5
const XAI_EN_WORDS_PER_SECOND = 1.7
const XAI_SPEECH_TAG = '[XAI_SPEECH: Speak every quoted line exactly, in order, in full, once. Do not repeat a line in a later beat. Do not replace a line with a shorter slogan, and do not add a line that is not quoted. Finish the last word at least one second before the clip ends.]'
const XAI_STILL_TAG = '[XAI_STILL: <IMAGE_0> is shot 1 of this clip and the exact opening instant. Keep its framing, people, food, props, and setting. Later beats in the timeline move away from this picture. Do not redraw those later beats into the opening frame.]'

/**
 * Pinning a still makes it `<IMAGE_0>`. Asset refs move to `<IMAGE_1>` and up.
 * Idempotent once the still tag is present.
 */
export function pinXaiStoryboardStill(prompt: string) {
  const source = String(prompt || '').trim()
  if (!source || source.includes('[XAI_STILL:')) return source
  const shifted = source.replace(/<IMAGE_(\d+)>/g, (_token, raw) => `<IMAGE_${Number(raw) + 1}>`)
  return `${shifted}\n${XAI_STILL_TAG}`
}

const TIMELINE_LINE = /^(\s*)(?:\[(\d+)\s*[-–~—]\s*(\d+)\s*s\]|(\d+)\s*[-–~—]\s*(\d+)\s*秒)[：:]?\s*(.*)$/u

function timelineLines(prompt: string) {
  return String(prompt || '').split('\n').filter((line) => TIMELINE_LINE.test(line))
}

/** One quoted speech can hold several sentences. Each sentence is placed on its own beat. */
function speechSentences(text: string) {
  const parts = String(text || '')
    .split(/(?<=[。！？!?])/u)
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length ? parts : []
}

function refNameInText(name: string, text: string) {
  const parts = String(name || '')
    .split(/[·•|]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
  return parts.some((part) => text.includes(part))
}

/**
 * The video skill writes the lines. This only reports a draft that repeats a
 * line, drops one, or leaves one outside the timeline, so the skill can write it again.
 */
export function xaiSpokenLineIssues(prompt: string, description?: string | null) {
  const wanted: string[] = []
  const seenWanted = new Set<string>()
  for (const line of extractSpokenLines(String(description || ''))) {
    for (const text of speechSentences(line.text)) {
      if (seenWanted.has(text)) continue
      seenWanted.add(text)
      wanted.push(text)
    }
  }
  const timeline = timelineLines(prompt)
  const counts = new Map<string, number>()
  for (const line of timeline) {
    for (const text of spokenChunks(line)) counts.set(text, (counts.get(text) || 0) + 1)
  }
  for (const text of wanted) {
    const hits = timeline.filter((line) => line.includes(text)).length
    if (hits > (counts.get(text) || 0)) counts.set(text, hits)
  }
  const repeated = [...counts.entries()].filter(([, count]) => count > 1).map(([text]) => text)
  const missing = wanted.filter((text) => (counts.get(text) || 0) === 0)
  return { repeated, missing }
}

/** A beat that names a reference must use that reference's own `<IMAGE_N>`. */
export function xaiBeatImageIssues(
  prompt: string,
  refs: Array<{ index: number; name?: string | null }>,
) {
  const named = refs.filter((ref) => String(ref.name || '').trim().length >= 2)
  const mismatched: string[] = []
  const seen = new Set<string>()
  for (const line of timelineLines(prompt)) {
    const tokens = new Set([...line.matchAll(/<IMAGE_(\d+)>/g)].map((item) => Number(item[1])))
    for (const ref of named) {
      const name = String(ref.name || '').trim()
      if (!refNameInText(name, line) || tokens.has(ref.index) || seen.has(name)) continue
      seen.add(name)
      mismatched.push(name)
    }
  }
  return mismatched
}

function stripXaiSpeechTag(prompt: string) {
  return prompt.replace(/\n*\[XAI_SPEECH:[\s\S]*?\]\s*$/u, '').trim()
}

function spokenChunks(line: string) {
  const chunks: string[] = []
  const seen = new Set<string>()
  const push = (text: string) => {
    const value = text.trim()
    if (!value || seen.has(value)) return
    seen.add(value)
    chunks.push(value)
  }
  for (const row of extractSpokenLines(line)) push(row.text)
  const quoteRe = /[「“"]([^」”"\n]{1,300})[」”"]/g
  let match: RegExpExecArray | null
  while ((match = quoteRe.exec(line))) push(String(match[1] || ''))
  if (!chunks.length) {
    const narrator = line.match(/(?:旁白)[：:]\s*(.+)$/u)
    if (narrator?.[1]) push(narrator[1])
  }
  return chunks
}

/** Seconds Grok needs to speak this line. Acted speech is slower than a TTS estimate. */
export function xaiSpeechSeconds(line: string) {
  const chunks = spokenChunks(line)
  if (!chunks.length) return 0
  let total = 0
  for (const chunk of chunks) {
    const cjk = (chunk.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g) || []).length
    const words = (chunk.match(/[A-Za-z0-9']+/g) || []).length
    if (cjk === 0 && words === 0) {
      total += Math.max(1, chunk.length / 4)
    } else if (cjk >= words) {
      total += cjk / XAI_CJK_CHARS_PER_SECOND
    } else {
      total += words / XAI_EN_WORDS_PER_SECOND
    }
  }
  if (chunks.length > 1) total += (chunks.length - 1) * 0.4
  return total
}

function clampXaiDuration(value: number | null | undefined, max: number) {
  const parsed = Math.round(Number(value || 8))
  if (!Number.isFinite(parsed)) return Math.min(max, 8)
  return Math.min(max, Math.max(1, parsed))
}

type TimelineSegment = {
  lineIndex: number
  end: number
  start: number
  body: string
  bracket: boolean
  speech: number
}

function parseTimelineLine(line: string, lineIndex: number): TimelineSegment | null {
  const match = line.match(TIMELINE_LINE)
  if (!match) return null
  const bracket = match[2] != null
  const start = Number(bracket ? match[2] : match[4])
  const end = Number(bracket ? match[3] : match[5])
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return {
    lineIndex,
    start,
    end,
    body: String(match[6] || '').trim(),
    bracket,
    speech: xaiSpeechSeconds(line),
  }
}

function shrinkToBudget(lengths: number[], speech: number[], budget: number) {
  const next = lengths.slice()
  let overflow = next.reduce((sum, item) => sum + item, 0) - budget
  for (let i = 0; i < next.length && overflow > 0; i++) {
    if (speech[i] > 0) continue
    const cut = Math.min(Math.max(0, next[i] - 1), overflow)
    next[i] -= cut
    overflow -= cut
  }
  if (overflow > 0) {
    const speechIndexes = next.map((_, index) => index).filter((index) => speech[index] > 0)
    const speechSum = speechIndexes.reduce((sum, index) => sum + next[index], 0)
    const target = Math.max(speechIndexes.length, speechSum - overflow)
    let assigned = 0
    speechIndexes.forEach((index, order) => {
      if (order === speechIndexes.length - 1) {
        next[index] = Math.max(1, target - assigned)
        return
      }
      const share = Math.max(1, Math.round((next[index] / speechSum) * target))
      next[index] = share
      assigned += share
    })
  }
  return next
}

/**
 * Grok stops at the clip boundary and inside a short timeline beat.
 * Stretch any beat that contains speech, then leave one silent second after the last word.
 */
export function fitXaiSpokenClip(prompt: string, requested?: number | null, max = XAI_DURATION_MAX) {
  const cap = Math.min(XAI_DURATION_MAX, Math.max(1, Math.round(max) || XAI_DURATION_MAX))
  const clean = stripXaiSpeechTag(String(prompt || ''))
  const asked = clampXaiDuration(requested, cap)
  if (!clean) return { prompt: clean, duration: asked }
  const lines = clean.split('\n')
  const segments = lines
    .map((line, index) => parseTimelineLine(line, index))
    .filter((segment): segment is TimelineSegment => Boolean(segment))
  const looseSpeech = lines.reduce((sum, line, index) => {
    if (segments.some((segment) => segment.lineIndex === index)) return sum
    return sum + xaiSpeechSeconds(line)
  }, 0)
  const segmentSpeech = segments.reduce((sum, segment) => sum + segment.speech, 0)
  if (segmentSpeech + looseSpeech <= 0) return { prompt: clean, duration: asked }

  let duration = asked
  let nextLines = lines
  if (segments.length) {
    const speech = segments.map((segment) => segment.speech)
    let lengths = segments.map((segment) => {
      const span = Math.max(1, segment.end - segment.start)
      if (segment.speech <= 0) return span
      return Math.max(span, Math.ceil(segment.speech))
    })
    if (looseSpeech > 0 && lengths.length) {
      lengths[lengths.length - 1] += Math.ceil(looseSpeech)
    }
    const tail = XAI_SPEECH_TAIL_SECONDS
    const budget = Math.max(segments.length, cap - tail)
    if (lengths.reduce((sum, item) => sum + item, 0) > budget) {
      lengths = shrinkToBudget(lengths, speech, budget)
    }
    const sum = lengths.reduce((total, item) => total + item, 0)
    const lastSpeech = segments.reduce((found, segment, index) => (segment.speech > 0 ? index : found), -1)
    const alreadyHasTail = lastSpeech >= 0 && lastSpeech < segments.length - 1
    const endAt = Math.min(cap, Math.max(asked, sum + (alreadyHasTail ? 0 : tail)))
    const extra = Math.max(0, endAt - sum)
    let cursor = 0
    nextLines = lines.slice()
    segments.forEach((segment, index) => {
      const start = cursor
      const isLast = index === segments.length - 1
      const end = cursor + lengths[index] + (isLast && lastSpeech !== index ? extra : 0)
      cursor = end
      const marker = segment.bracket ? `[${start}-${end}s]` : `${start}-${end}秒：`
      nextLines[segment.lineIndex] = `${marker} ${segment.body}`.trim()
    })
    if (lastSpeech === segments.length - 1 && extra > 0) {
      nextLines.push(`[${cursor}-${cursor + extra}s] Hold. The spoken line has already finished. No more speech.`)
      cursor += extra
    }
    duration = cursor
  } else {
    duration = Math.min(cap, Math.max(asked, Math.ceil(segmentSpeech + looseSpeech) + XAI_SPEECH_TAIL_SECONDS))
  }

  const tagged = `${nextLines.join('\n').trim()}\n\n${XAI_SPEECH_TAG}`
  return { prompt: tagged, duration }
}

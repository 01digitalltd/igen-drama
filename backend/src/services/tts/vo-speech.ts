import { isMiniMaxH3Max } from '../adapters/minimax-video.js'
import { isOmniVideoConfig } from '../video-clip-policy.js'
import type { TtsGender } from './minimax-voice.js'

export const MAX_VO_AUDIO_CLIPS = 3

export type VoSpeakerKind = 'narrator' | 'character'

export type VoSpeechLine = {
  kind: VoSpeakerKind
  speaker: string
  text: string
}

export type VoAudioClip = {
  speaker: string
  kind: VoSpeakerKind
  url: string
  voiceId: string
  text: string
}

const SKIP_SPEECH = /^(?:无旁白|無旁白|无对白|無對白|no\s+(?:voice-?over|dialogue)|n\/a)$/i
const NARRATOR_LINE =
  /(?<![无無])(?:女声|男声|女聲|男聲)?旁白(?:（[^）]*）)?[：:]\s*(.+)$/u
const DIALOGUE_LINE =
  /[@＠]?([\u4e00-\u9fffA-Za-z0-9._-]{1,20}?)(?:说|說)[：:]\s*[「「""]([^」」""]+)[」」""]/gu

export function extractSpokenLines(prompt: string): VoSpeechLine[] {
  const lines: VoSpeechLine[] = []
  for (const raw of String(prompt || '').split(/\n+/)) {
    const line = raw.replace(/^\s*(?:\d+\s*[-–—~]\s*\d+\s*秒[：:]|\[\d+-\d+s\])\s*/u, '').trim()
    if (!line) continue
    const narrator = line.match(NARRATOR_LINE)
    if (narrator) {
      const text = cleanSpeechText(narrator[1])
      if (text) lines.push({ kind: 'narrator', speaker: '旁白', text })
    }
    for (const dialogue of line.matchAll(DIALOGUE_LINE)) {
      const speaker = String(dialogue[1] || '').trim()
      const text = cleanSpeechText(dialogue[2])
      if (speaker && text && !SKIP_SPEECH.test(speaker) && !/旁白/.test(speaker)) {
        lines.push({ kind: 'character', speaker, text })
      }
    }
  }
  return lines
}

function cleanSpeechText(raw?: string | null) {
  const text = String(raw || '')
    .replace(/（S1[^）]*）/g, '')
    .replace(/\(S1[^)]*\)/g, '')
    .trim()
  if (!text || SKIP_SPEECH.test(text)) return ''
  return text
}

export function groupSpokenLines(lines: VoSpeechLine[]): VoSpeechLine[] {
  const order: string[] = []
  const grouped = new Map<string, VoSpeechLine>()
  for (const line of lines) {
    const key = `${line.kind}:${line.speaker}`
    const existing = grouped.get(key)
    if (existing) {
      existing.text = `${existing.text} ${line.text}`.trim()
      continue
    }
    order.push(key)
    grouped.set(key, { ...line })
  }
  return order.map((key) => grouped.get(key)!).filter(Boolean)
}

/** Narrator first, then characters in first-appearance order. Cap 3 (Seedance / H3). */
export function pickSpokenLinesForRefAudio(lines: VoSpeechLine[]): VoSpeechLine[] {
  const grouped = groupSpokenLines(lines)
  const narrator = grouped.filter((row) => row.kind === 'narrator')
  const characters = grouped.filter((row) => row.kind === 'character')
  return [...narrator, ...characters].slice(0, MAX_VO_AUDIO_CLIPS)
}

export function parseVoAudioClips(raw: unknown): VoAudioClip[] {
  if (!raw) return []
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text) return []
    try {
      parsed = JSON.parse(text)
    } catch {
      return []
    }
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { clips?: unknown }).clips)
      ? (parsed as { clips: unknown[] }).clips
      : []
  const clips: VoAudioClip[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const url = String(row.url || '').trim()
    const speaker = String(row.speaker || '').trim()
    const text = String(row.text || '').trim()
    const voiceId = String(row.voiceId || row.voice_id || '').trim()
    const kind = row.kind === 'character' ? 'character' : 'narrator'
    if (!url || !speaker) continue
    clips.push({ speaker, kind, url, voiceId, text })
  }
  return clips.slice(0, MAX_VO_AUDIO_CLIPS)
}

export function voAudioFingerprint(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ''
  return String((raw as { fingerprint?: unknown }).fingerprint || '').trim()
}

export function parseVoAudioPayload(raw: unknown): { fingerprint: string; clips: VoAudioClip[] } {
  if (!raw) return { fingerprint: '', clips: [] }
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text) return { fingerprint: '', clips: [] }
    try {
      return parseVoAudioPayload(JSON.parse(text))
    } catch {
      return { fingerprint: '', clips: [] }
    }
  }
  if (typeof raw !== 'object') return { fingerprint: '', clips: [] }
  return {
    fingerprint: voAudioFingerprint(raw),
    clips: parseVoAudioClips(raw),
  }
}

export function serializeVoAudioClips(clips: VoAudioClip[], fingerprint: string) {
  return JSON.stringify({
    fingerprint,
    clips: clips.map((clip) => ({
      speaker: clip.speaker,
      kind: clip.kind,
      url: clip.url,
      voiceId: clip.voiceId,
      text: clip.text,
    })),
  })
}

export function appendAudioRefDirective(prompt: string, clips: VoAudioClip[]) {
  const base = String(prompt || '').replace(/\n\n\[VO_AUDIO_REFS:[\s\S]*$/u, '').trim()
  if (!clips.length) return base
  const mapping = clips
    .map((clip, index) => `@Audio ${index + 1} is ${clip.kind === 'narrator' ? '旁白 S1' : clip.speaker}`)
    .join('; ')
  const tag = `[VO_AUDIO_REFS: ${mapping}. Follow each reference_audio for timbre, emotion, and spoken words. Do not mix speakers. Do not invent BGM that covers dialogue.]`
  return base ? `${base}\n\n${tag}` : tag
}

export function canUseReferenceAudio(provider?: string | null, model?: string | null) {
  if (isOmniVideoConfig(provider, model)) return false
  if (isMiniMaxH3Max(model)) return false
  return true
}

export function shouldSynthesizeAutoTts(clientAudioCount: number) {
  return !(Number(clientAudioCount) > 0)
}

export type CharacterGenderHint = {
  name: string
  appearance?: string | null
  description?: string | null
}

export function genderForSpeaker(
  line: VoSpeechLine,
  narratorGender: TtsGender,
  characters: CharacterGenderHint[],
): TtsGender {
  if (line.kind === 'narrator') return narratorGender
  const hit = characters.find((row) => row.name === line.speaker)
  const blob = [hit?.appearance, hit?.description, line.speaker].filter(Boolean).join(' ')
  return inferGenderWithFallback(blob, narratorGender)
}

function inferGenderWithFallback(text: string, fallback: TtsGender): TtsGender {
  if (/女|她|小姐|姑娘|女士|female|woman|girl/i.test(text)) return 'female'
  if (/男|他|先生|male|man|boy|大叔|哥哥|弟弟/i.test(text)) return 'male'
  return fallback
}

export function previewSampleText(languageCode?: string | null) {
  const code = String(languageCode || '').trim()
  if (code === 'yue-HK') return '你好，呢度係旁白試聽。'
  if (code === 'cmn-CN') return '你好，这是旁白试听。'
  if (code === 'en-US') return 'Hello, this is a narrator preview.'
  return '你好，這是旁白試聽。'
}

export function buildVoFingerprint(parts: {
  prompt: string
  language: string
  voice: string
  emotion: string
  speed: number
}) {
  return [
    parts.prompt.trim(),
    parts.language,
    parts.voice,
    parts.emotion,
    String(parts.speed),
  ].join('\u001f')
}

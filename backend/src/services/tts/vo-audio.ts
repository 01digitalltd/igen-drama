import { createHash } from 'crypto'
import { db, schema } from '../../db/index.js'
import { eq } from '../../db/query.js'
import { now } from '../../utils/response.js'
import { saveAudioBuffer } from '../../utils/storage.js'
import { getDramaDialogueLanguage } from '../dialogue-language.js'
import { getDramaVoVoice, normalizeVoVoice } from '../vo-voice.js'
import { resolveStoryboardVideoPrompt } from '../storyboard-prompt.js'
import {
  emotionFromAtmosphere,
  resolveSystemVoiceId,
  resolveTtsSpeed,
  speedFromAtmosphere,
  type TtsEmotion,
  type TtsGender,
} from './minimax-voice.js'
import { isMiniMaxTtsConfigured, synthesizeMiniMaxMp3 } from './minimax-tts.js'
import {
  buildVoFingerprint,
  extractSpokenLines,
  genderForSpeaker,
  parseVoAudioPayload,
  pickSpokenLinesForRefAudio,
  serializeVoAudioClips,
  type VoAudioClip,
} from './vo-speech.js'
import { voTtsSettingsFromMetadata } from './vo-tts-settings.js'

const TTS_MAX_CONCURRENT = 2
let ttsActive = 0
const ttsWaiters: Array<() => void> = []

async function withTtsSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (ttsActive >= TTS_MAX_CONCURRENT) {
    await new Promise<void>((resolve) => ttsWaiters.push(resolve))
  }
  ttsActive += 1
  try {
    return await fn()
  } finally {
    ttsActive -= 1
    ttsWaiters.shift()?.()
  }
}

function hashFingerprint(value: string) {
  return createHash('sha1').update(value).digest('hex')
}

export async function clearVoAudioForDrama(dramaId: number) {
  if (!Number.isInteger(dramaId) || dramaId <= 0) return
  const eps = await db.select().from(schema.episodes).where(eq(schema.episodes.dramaId, dramaId))
  const ts = now()
  for (const ep of eps) {
    await db.update(schema.storyboards)
      .set({ voAudioUrls: null, updatedAt: ts })
      .where(eq(schema.storyboards.episodeId, ep.id))
  }
}

export async function clearVoAudioForStoryboard(storyboardId: number) {
  if (!Number.isInteger(storyboardId) || storyboardId <= 0) return
  await db.update(schema.storyboards)
    .set({ voAudioUrls: null, updatedAt: now() })
    .where(eq(schema.storyboards.id, storyboardId))
}

async function loadStoryboardCharacters(storyboardId: number) {
  const binds = await db.select().from(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId))
  const ids = binds.map((row) => Number(row.characterId)).filter((id) => Number.isInteger(id) && id > 0)
  if (!ids.length) return []
  const chars = await db.select().from(schema.characters)
  return chars.filter((row) => ids.includes(Number(row.id)))
}

export async function ensureStoryboardVoAudio(opts: {
  storyboardId: number
  dramaId?: number | null
  prompt?: string | null
}): Promise<{ clips: VoAudioClip[]; warning?: string }> {
  if (!isMiniMaxTtsConfigured()) {
    return { clips: [], warning: '未設定 MiniMax TTS（MINIMAX_API_KEY），該鏡不帶配音參考。' }
  }

  const [sb] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, opts.storyboardId))
  if (!sb) return { clips: [] }

  let dramaId = Number(opts.dramaId || 0)
  if (!Number.isInteger(dramaId) || dramaId <= 0) {
    const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId))
    dramaId = Number(ep?.dramaId || 0)
  }
  const [drama] = Number.isInteger(dramaId) && dramaId > 0
    ? await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
    : []

  const prompt = String(opts.prompt || resolveStoryboardVideoPrompt(sb) || '').trim()
  const language = await getDramaDialogueLanguage(dramaId || null)
  const voice = normalizeVoVoice(drama?.voVoice || await getDramaVoVoice(dramaId || null))
  const settings = voTtsSettingsFromMetadata(drama?.metadata)
  const emotion: TtsEmotion = settings.emotion === 'auto'
    ? emotionFromAtmosphere(sb.atmosphere)
    : settings.emotion
  const speed = settings.speed ?? speedFromAtmosphere(sb.atmosphere)
  const fingerprint = hashFingerprint(buildVoFingerprint({
    prompt,
    language,
    voice,
    emotion,
    speed,
  }))

  const stored = parseVoAudioPayload(sb.voAudioUrls)
  if (stored.fingerprint === fingerprint && stored.clips.length) {
    return { clips: stored.clips }
  }

  const lines = pickSpokenLinesForRefAudio(extractSpokenLines(prompt))
  if (!lines.length) {
    await db.update(schema.storyboards)
      .set({ voAudioUrls: serializeVoAudioClips([], fingerprint), updatedAt: now() })
      .where(eq(schema.storyboards.id, opts.storyboardId))
    return { clips: [] }
  }

  const characters = await loadStoryboardCharacters(opts.storyboardId)
  const narratorGender = voice as TtsGender
  const clips: VoAudioClip[] = []
  try {
    for (const line of lines) {
      const gender = genderForSpeaker(line, narratorGender, characters)
      const voiceId = resolveSystemVoiceId({ languageCode: language, gender })
      const buffer = await withTtsSlot(() => synthesizeMiniMaxMp3({
        text: line.text,
        voiceId,
        languageCode: language,
        speed,
        emotion,
      }))
      const url = await saveAudioBuffer(buffer)
      clips.push({
        speaker: line.speaker,
        kind: line.kind,
        url,
        voiceId,
        text: line.text,
      })
    }
  } catch (err) {
    const warning = String((err as Error)?.message || err || 'MiniMax TTS failed')
    return { clips: [], warning }
  }

  await db.update(schema.storyboards)
    .set({ voAudioUrls: serializeVoAudioClips(clips, fingerprint), updatedAt: now() })
    .where(eq(schema.storyboards.id, opts.storyboardId))
  return { clips }
}

import { parseDramaMetadata } from '../../utils/ad-taxonomy.js'
import { isTtsEmotion, resolveTtsSpeed, type TtsEmotion } from './minimax-voice.js'

export type VoTtsSettings = {
  emotion: TtsEmotion | 'auto'
  speed: number | null
}

export function voTtsSettingsFromMetadata(raw?: unknown): VoTtsSettings {
  const meta = parseDramaMetadata(raw)
  const emotionRaw = String(meta.vo_emotion || '').trim().toLowerCase()
  const emotion = emotionRaw === 'auto' || isTtsEmotion(emotionRaw) ? emotionRaw : 'auto'
  const speedRaw = Number(meta.vo_speed)
  const speed = Number.isFinite(speedRaw) ? resolveTtsSpeed(speedRaw) : null
  return { emotion, speed }
}

export function mergeVoTtsMetadata(
  existing: unknown,
  patch: { emotion?: string | null; speed?: number | null },
): string {
  const meta = parseDramaMetadata(existing)
  if (patch.emotion !== undefined) {
    const emotion = String(patch.emotion || '').trim().toLowerCase()
    meta.vo_emotion = emotion === 'auto' || isTtsEmotion(emotion) ? emotion : 'auto'
  }
  if (patch.speed !== undefined) {
    meta.vo_speed = patch.speed == null ? null : resolveTtsSpeed(patch.speed)
  }
  return JSON.stringify(meta)
}

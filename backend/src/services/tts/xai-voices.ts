import type { TtsGender } from './minimax-voice.js'
import {
  genderForSpeaker,
  pickSpokenLinesForRefAudio,
  type CharacterGenderHint,
  type VoSpeechLine,
} from './vo-speech.js'

export type XaiVoiceRef = {
  voiceId: string
  speaker: string
  kind: 'narrator' | 'character'
}

/** Preset xAI voices. Narrator and a same-gender character must not share one id. */
export function xaiVoiceIdForSpeaker(
  kind: 'narrator' | 'character',
  gender: TtsGender,
  narratorGender: TtsGender,
) {
  if (kind === 'narrator') return narratorGender === 'male' ? 'rex' : 'ara'
  if (gender === 'male') return narratorGender === 'male' ? 'leo' : 'rex'
  return narratorGender === 'male' ? 'ara' : 'eve'
}

export function selectXaiReferenceVoices(opts: {
  lines: VoSpeechLine[]
  narratorGender: TtsGender
  characters?: CharacterGenderHint[]
}): XaiVoiceRef[] {
  return pickSpokenLinesForRefAudio(opts.lines).map((line) => {
    const gender = genderForSpeaker(line, opts.narratorGender, opts.characters || [])
    return {
      voiceId: xaiVoiceIdForSpeaker(line.kind, gender, opts.narratorGender),
      speaker: line.kind === 'narrator' ? '旁白' : line.speaker,
      kind: line.kind,
    }
  })
}

export function appendXaiVoiceDirective(prompt: string, voices: XaiVoiceRef[]) {
  const base = String(prompt || '').replace(/\n\n\[XAI_VOICES:[\s\S]*$/u, '').trim()
  if (!voices.length) return base
  const mapping = voices
    .map((voice, index) => `${voice.speaker} uses reference voice ${index + 1} (${voice.voiceId})`)
    .join('; ')
  const tag = `[XAI_VOICES: ${mapping}. Speak each person's lines in that voice. No background music, no singing.]`
  return base ? `${base}\n\n${tag}` : tag
}

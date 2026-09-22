/** MiniMax system voices for drama TTS. Keep in sync with mkt-ai minimaxVoiceConfig.js. */

export type TtsGender = 'female' | 'male'

const LANGUAGE_BOOST_BY_CODE: Record<string, string> = {
  'yue-HK': 'Chinese,Yue',
  'cmn-CN': 'Chinese',
  'cmn-TW': 'Chinese',
  'en-US': 'English',
}

const VOICE_BY_LANGUAGE_AND_GENDER: Record<string, Record<TtsGender, string>> = {
  'yue-HK': {
    female: 'Cantonese_GentleLady',
    male: 'Cantonese_ProfessionalHost（M)',
  },
  'cmn-CN': {
    female: 'Chinese (Mandarin)_Sweet_Lady',
    male: 'Chinese (Mandarin)_Gentleman',
  },
  'cmn-TW': {
    female: 'Chinese (Mandarin)_Warm_Girl',
    male: 'Chinese (Mandarin)_Gentle_Youth',
  },
  'en-US': {
    female: 'English_Graceful_Lady',
    male: 'English_Trustworth_Man',
  },
}

const MINIMAX_VOICE_ID_ALIASES: Record<string, string> = {
  'Cantonese_ProfessionalHost (F)': 'Cantonese_ProfessionalHost（F)',
  'Cantonese_ProfessionalHost (M)': 'Cantonese_ProfessionalHost（M)',
}

export function resolveLanguageBoost(languageCode?: string | null) {
  const code = String(languageCode || '').trim() || 'cmn-TW'
  return LANGUAGE_BOOST_BY_CODE[code] || 'auto'
}

export function resolveMiniMaxVoiceId(voiceId?: string | null) {
  const id = String(voiceId || '').trim()
  return MINIMAX_VOICE_ID_ALIASES[id] || id
}

export function resolveSystemVoiceId(opts: {
  languageCode?: string | null
  gender?: string | null
  voiceName?: string | null
}) {
  const requested = String(opts.voiceName || '').trim()
  if (requested) return resolveMiniMaxVoiceId(requested)
  const language = String(opts.languageCode || '').trim() || 'cmn-TW'
  const gender = String(opts.gender || '').trim().toLowerCase()
  if (gender === 'male' || gender === 'female') {
    const byGender = VOICE_BY_LANGUAGE_AND_GENDER[language]?.[gender]
    if (byGender) return byGender
  }
  return VOICE_BY_LANGUAGE_AND_GENDER[language]?.female
    || VOICE_BY_LANGUAGE_AND_GENDER['cmn-TW'].female
}

export function resolveTtsSpeed(speakingRate?: number | null) {
  const n = Number(speakingRate)
  if (!Number.isFinite(n)) return 1
  return Math.min(1.15, Math.max(0.85, +n.toFixed(2)))
}

export const TTS_EMOTIONS = ['calm', 'happy', 'sad', 'angry', 'fluent'] as const
export type TtsEmotion = (typeof TTS_EMOTIONS)[number]

export function isTtsEmotion(value: unknown): value is TtsEmotion {
  return typeof value === 'string' && (TTS_EMOTIONS as readonly string[]).includes(value)
}

export function inferGenderFromText(raw?: string | null, fallback: TtsGender = 'female'): TtsGender {
  const text = String(raw || '')
  if (/女|她|小姐|姑娘|女士|female|woman|girl/i.test(text)) return 'female'
  if (/男|他|先生|male|man|boy|大叔|哥哥|弟弟/i.test(text)) return 'male'
  return fallback
}

export function emotionFromAtmosphere(atmosphere?: string | null): TtsEmotion {
  const text = String(atmosphere || '')
  if (/怒|气愤|氣憤|angry|火大/i.test(text)) return 'angry'
  if (/悲|哭|伤|傷|sad|沉重/i.test(text)) return 'sad'
  if (/喜|笑|开怀|開懷|happy|轻快|輕快/i.test(text)) return 'happy'
  if (/急|紧张|緊張|赶|趕|fluent|匆忙/i.test(text)) return 'fluent'
  return 'calm'
}

export function speedFromAtmosphere(atmosphere?: string | null) {
  const emotion = emotionFromAtmosphere(atmosphere)
  if (emotion === 'fluent' || emotion === 'angry') return 1.1
  if (emotion === 'sad') return 0.9
  if (emotion === 'happy') return 1.05
  return 1
}

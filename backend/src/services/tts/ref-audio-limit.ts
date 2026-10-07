import { extractSpokenLines, groupSpokenLines } from './vo-speech.js'

/** Seedance 2.0 r2v rejects each reference_audio longer than this. */
export const SEEDANCE_R2V_MAX_AUDIO_SECONDS = 15.2

/** Same pace as the wizard warning, so a shot that passes the split also passes the UI. */
const SPOKEN_CHARS_PER_SECOND_CJK = 3.8
const SPOKEN_CHARS_PER_SECOND_JA = 3.5
const SPOKEN_WORDS_PER_SECOND_EN = 2.4

export function refAudioExceedsLimit(
  seconds: number | null | undefined,
  max = SEEDANCE_R2V_MAX_AUDIO_SECONDS,
) {
  const n = Number(seconds)
  return Number.isFinite(n) && n > max + 0.001
}

export function formatAudioSeconds(seconds: number) {
  return (Math.round(seconds * 10) / 10).toFixed(1)
}

export function refAudioTooLongMessage(seconds: number, max = SEEDANCE_R2V_MAX_AUDIO_SECONDS) {
  return `這一鏡旁白 ${formatAudioSeconds(seconds)} 秒，超過 Seedance 參考音訊上限 ${max} 秒。請縮短對白，或把這一鏡拆成兩鏡。`
}

type ReferenceAudioSpeechBudget = {
  maxSeconds: number
  maxChars: number | null
  maxWords: number | null
}

export function referenceAudioSpeechBudget(languageCode: string): ReferenceAudioSpeechBudget {
  const code = String(languageCode || '').trim().toLowerCase()
  if (code.startsWith('en')) {
    return {
      maxSeconds: SEEDANCE_R2V_MAX_AUDIO_SECONDS,
      maxChars: null,
      maxWords: Math.floor(SEEDANCE_R2V_MAX_AUDIO_SECONDS * SPOKEN_WORDS_PER_SECOND_EN),
    }
  }
  const cps = code.startsWith('ja') ? SPOKEN_CHARS_PER_SECOND_JA : SPOKEN_CHARS_PER_SECOND_CJK
  return {
    maxSeconds: SEEDANCE_R2V_MAX_AUDIO_SECONDS,
    maxChars: Math.floor(SEEDANCE_R2V_MAX_AUDIO_SECONDS * cps),
    maxWords: null,
  }
}

function countLatinWords(text: string) {
  const matched = text.match(/[a-zA-Z0-9']+/g)
  return matched ? matched.length : 0
}

function countCjkCharacters(text: string) {
  return (text.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g) || []).length
}

/** Conservative spoken duration. Matches the wizard estimate used to block long voiceover. */
function estimateSpokenSeconds(text: string, languageCode: string) {
  const spoken = String(text || '').trim()
  if (!spoken) return 0
  const code = String(languageCode || '').trim().toLowerCase()
  const latinWords = countLatinWords(spoken)
  const cjkChars = countCjkCharacters(spoken)
  const otherLen = Math.max(0, spoken.length - cjkChars)
  if (code.startsWith('en') && latinWords >= Math.max(1, cjkChars)) {
    return latinWords / SPOKEN_WORDS_PER_SECOND_EN
  }
  const cps = code.startsWith('ja') ? SPOKEN_CHARS_PER_SECOND_JA : SPOKEN_CHARS_PER_SECOND_CJK
  const effectiveChars = cjkChars + Math.ceil(otherLen * 0.45)
  return effectiveChars / cps
}

type RefAudioOverflow = { speaker: string; seconds: number }

/** Longest grouped narrator/character clips, same grouping as TTS reference audio. */
export function findRefAudioOverflows(prompt: string, languageCode: string): RefAudioOverflow[] {
  const grouped = groupSpokenLines(extractSpokenLines(prompt))
  const narrator = grouped.filter((row) => row.kind === 'narrator')
  const characters = grouped.filter((row) => row.kind === 'character')
  return [...narrator, ...characters]
    .slice(0, 3)
    .map((clip) => ({
      speaker: clip.speaker,
      seconds: estimateSpokenSeconds(clip.text, languageCode),
    }))
    .filter((row) => refAudioExceedsLimit(row.seconds))
}

export function formatRefAudioSplitError(
  rows: Array<{ shotNumber: number; speaker: string; seconds: number }>,
) {
  const detail = rows
    .map((row) => `第 ${row.shotNumber} 镜${row.speaker}约 ${formatAudioSeconds(row.seconds)} 秒`)
    .join('，')
  return `${detail}，超过参考音讯上限 ${SEEDANCE_R2V_MAX_AUDIO_SECONDS} 秒。同一说话人在一镜内的旁白或台词会合成一条音讯。请拆到下一镜；若会超出段数或总时长上限，只删招呼、感叹和重复，每一小句的事实仍要留下。然后重新调用 save_storyboards，第一批 replace_existing: true。`
}

export function referenceAudioBudgetLine(languageCode: string) {
  const budget = referenceAudioSpeechBudget(languageCode)
  const unit = budget.maxWords != null
    ? `约 ${budget.maxWords} 个英文词`
    : `约 ${budget.maxChars} 个字`
  return `同一说话人的旁白或台词合并后不得超过 ${budget.maxSeconds} 秒（${unit}）。不要把画面描述里的对白加长；超标就压缩到上限内，不要新写台词。`
}

/** Replace the provider's content[n] audio-duration rejection with a shot-level message. */
export function rewriteSeedanceAudioLimitError(message: string) {
  const text = String(message || '')
  if (/audio duration/i.test(text) && /15\.2/.test(text)) {
    return `參考音訊超過 ${SEEDANCE_R2V_MAX_AUDIO_SECONDS} 秒，Seedance 無法出片。請縮短這一鏡的對白，或拆成兩鏡。`
  }
  return text
}

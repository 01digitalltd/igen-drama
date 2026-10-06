/** Seedance 2.0 r2v rejects each reference_audio longer than this. */
export const SEEDANCE_R2V_MAX_AUDIO_SECONDS = 15.2

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

/** Replace the provider's content[n] audio-duration rejection with a shot-level message. */
export function rewriteSeedanceAudioLimitError(message: string) {
  const text = String(message || '')
  if (/audio duration/i.test(text) && /15\.2/.test(text)) {
    return `參考音訊超過 ${SEEDANCE_R2V_MAX_AUDIO_SECONDS} 秒，Seedance 無法出片。請縮短這一鏡的對白，或拆成兩鏡。`
  }
  return text
}

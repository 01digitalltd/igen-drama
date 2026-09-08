/**
 * Vendor HTTP error bodies vary: Google `{ error: { message } }`,
 * MiniMax `{ type: "error", error: { message } }`, or a plain string.
 * Poll must fail fast on 4xx instead of retrying until timeout.
 */
export const GEMINI_OMNI_PERSON_BLOCK_ZH_HANT =
  'Gemini 內容安全攔截：只要成片會出現人物（含純文字短劇），Omni 常會一律拒絕，與有沒有角色定妝圖無關。請改用 MiniMax，或向 Google 開通成人像生成。'

export function isGeminiOmniPersonBlock(message: string) {
  const text = String(message || '')
  return /prohibited content guidelines/i.test(text)
    || text.includes('内容安全拦截')
    || text.includes('內容安全攔截')
}

export function annotateGeminiSafetyBlock(message: string) {
  const text = String(message || '').trim()
  if (!isGeminiOmniPersonBlock(text)) return text
  return GEMINI_OMNI_PERSON_BLOCK_ZH_HANT
}

export function parseProviderErrorText(
  status: number,
  text: string,
  fallback = `API error ${status}`,
): string {
  const raw = String(text || '').trim()
  if (!raw) return `${fallback}: HTTP ${status}`
  try {
    const json = JSON.parse(raw)
    const err = json?.error
    const message = typeof err === 'string'
      ? err
      : (err?.message || json?.message)
    if (typeof message === 'string' && message.trim()) {
      return annotateGeminiSafetyBlock(message.trim())
    }
  } catch {
    /* not JSON */
  }
  if (raw.length > 500) return annotateGeminiSafetyBlock(`${raw.slice(0, 500)}…`)
  return annotateGeminiSafetyBlock(raw)
}

export function isRetryableProviderStatus(status: number) {
  return status === 429 || status >= 500
}

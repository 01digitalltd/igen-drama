/**
 * Vendor HTTP error bodies vary: Google `{ error: { message } }`,
 * MiniMax `{ type: "error", error: { message } }`, or a plain string.
 * Poll must fail fast on 4xx instead of retrying until timeout.
 */
export const GEMINI_OMNI_PERSON_BLOCK_ZH_HANT =
  'Gemini 內容安全攔截：只要成片會出現人物（含純文字短劇），Omni 常會一律拒絕，與有沒有角色定妝圖無關。請改用 MiniMax，或向 Google 開通成人像生成。'

export const MINIMAX_INPUT_SENSITIVE_ZH_HANT =
  'MiniMax 內容審核攔截（輸入，代號 1026）：提示詞或參考圖被判定敏感。請改寫提示、拿掉真人臉參考圖後再試，不要用同一內容連續重試。'

export const MINIMAX_OUTPUT_SENSITIVE_ZH_HANT =
  'MiniMax 內容審核攔截（成片，代號 1027）：模型已生成但成片被判定敏感。常見原因是參考圖含真人臉或包裝／Logo 文字。請改用 3D 定妝圖、簡化提示後再生成一次，不要用同一鏡連續狂點。'

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

export function annotateMiniMaxSensitiveBlock(message: string) {
  const text = String(message || '').trim()
  if (/\[?1027\]|\boutput[_\s-]?sensitive\b/i.test(text)) return MINIMAX_OUTPUT_SENSITIVE_ZH_HANT
  if (/\[?1026\]|\binput[_\s-]?sensitive\b|video description contains sensitive/i.test(text)) {
    return MINIMAX_INPUT_SENSITIVE_ZH_HANT
  }
  return text
}

export function annotateProviderSafetyBlock(message: string) {
  return annotateMiniMaxSensitiveBlock(annotateGeminiSafetyBlock(message))
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
      return annotateProviderSafetyBlock(message.trim())
    }
  } catch {
    /* not JSON */
  }
  if (raw.length > 500) return annotateProviderSafetyBlock(`${raw.slice(0, 500)}…`)
  return annotateProviderSafetyBlock(raw)
}

export function isRetryableProviderStatus(status: number) {
  return status === 429 || status >= 500
}

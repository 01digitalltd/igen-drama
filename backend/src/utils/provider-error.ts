/**
 * Vendor HTTP error bodies vary: Google `{ error: { message } }`,
 * MiniMax `{ type: "error", error: { message } }`, or a plain string.
 * Poll must fail fast on 4xx instead of retrying until timeout.
 */
export function annotateGeminiSafetyBlock(message: string) {
  const text = String(message || '').trim()
  if (!/prohibited content guidelines/i.test(text)) return text
  if (text.includes('橙色网格') || text.includes('内容安全')) return text
  return `${text} Gemini 内容安全拦截：写实人脸或参考图上的网格线常被误判。请改用清洁定妆图后重试，或改用 MiniMax。`
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

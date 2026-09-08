/**
 * Vendor HTTP error bodies vary: Google `{ error: { message } }`,
 * MiniMax `{ type: "error", error: { message } }`, or a plain string.
 * Poll must fail fast on 4xx instead of retrying until timeout.
 */
export function annotateGeminiSafetyBlock(message: string) {
  const text = String(message || '').trim()
  if (!/prohibited content guidelines/i.test(text)) return text
  if (text.includes('内容安全')) return text
  return `${text} Gemini 内容安全拦截：只要成片会出现人物（含纯文字短剧），Omni 预览常一律拒绝，与有没有角色定妆图无关。请改用 MiniMax，或向 Google 开通成人像生成。`
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

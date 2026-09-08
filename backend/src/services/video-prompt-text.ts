export function extractGenerateText(result: unknown): string {
  if (!result || typeof result !== 'object') return ''
  const row = result as Record<string, unknown>
  if (typeof row.text === 'string' && row.text.trim()) return row.text.trim()
  if (typeof row.content === 'string' && row.content.trim()) return row.content.trim()
  return ''
}

export function looksLikeVideoPrompt(text: string) {
  const raw = String(text || '').trim()
  if (raw.length < 20) return false
  return /(\d+\s*[-–~—]\s*\d+\s*(?:秒|s)|\[\d+\s*[-–~—]\s*\d+\s*s\])/i.test(raw)
}

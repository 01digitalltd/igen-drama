export function extractGenerateText(result: unknown): string {
  if (!result || typeof result !== 'object') return ''
  const row = result as Record<string, unknown>
  if (typeof row.text === 'string' && row.text.trim()) return row.text.trim()
  if (typeof row.content === 'string' && row.content.trim()) return row.content.trim()
  if (Array.isArray(row.steps)) {
    for (let i = row.steps.length - 1; i >= 0; i--) {
      const step = row.steps[i]
      if (!step || typeof step !== 'object') continue
      const text = (step as Record<string, unknown>).text
      if (typeof text === 'string' && text.trim()) return text.trim()
    }
  }
  return ''
}

export function looksLikeVideoPrompt(text: string) {
  const raw = String(text || '').trim()
  if (raw.length < 20) return false
  return /(\d+\s*[-–~—]\s*\d+\s*(?:秒|s)|\[\d+\s*[-–~—]\s*\d+\s*s\])/i.test(raw)
}

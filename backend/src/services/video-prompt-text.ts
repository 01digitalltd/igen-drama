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

function tryParseJson(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return null
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = (fenced?.[1] || trimmed).trim()
  try {
    return JSON.parse(raw)
  } catch {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(raw.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

async function resolveMaybePromise<T>(value: T | Promise<T> | undefined): Promise<T | undefined> {
  if (value == null) return undefined
  return await Promise.resolve(value)
}

export async function payloadFromGenerateResult(result: unknown): Promise<unknown> {
  if (!result || typeof result !== 'object') return null
  const row = result as Record<string, unknown>
  const object = await resolveMaybePromise(row.object)
  if (object) return object
  if (Array.isArray(row.steps)) {
    for (let i = row.steps.length - 1; i >= 0; i--) {
      const step = row.steps[i]
      if (!step || typeof step !== 'object') continue
      const stepObject = await resolveMaybePromise((step as Record<string, unknown>).object)
      if (stepObject) return stepObject
    }
  }
  const text = await resolveMaybePromise(row.text)
  return tryParseJson(typeof text === 'string' ? text : '')
}

export function videoPromptFromPayload(payload: unknown): string {
  if (!payload) return ''
  if (typeof payload === 'string') return payload.trim()
  if (typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    for (const key of ['video_prompt', 'videoPrompt', 'prompt']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }
  return ''
}

export function summarizeGenerateResult(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return { empty: true }
  const row = result as Record<string, unknown>
  const toolCalls = Array.isArray(row.toolCalls) ? row.toolCalls : []
  const names = toolCalls.map((entry) => {
    if (!entry || typeof entry !== 'object') return ''
    const item = entry as Record<string, unknown>
    const payload = item.payload && typeof item.payload === 'object'
      ? item.payload as Record<string, unknown>
      : null
    return String(payload?.toolName || item.toolName || item.name || '')
  }).filter(Boolean)
  return {
    finishReason: row.finishReason ?? row.finish_reason ?? null,
    textLen: extractGenerateText(result).length,
    toolNames: names.join(',') || undefined,
    hasObject: row.object != null,
  }
}


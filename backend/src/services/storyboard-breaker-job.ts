/**
 * After storyboard_breaker generate(), treat "done with zero shots" as an error.
 * The model can finish without calling save_storyboards, or the tool can reject
 * over-budget batches and still return a successful generate().
 */

export type AgentToolResult = {
  toolName: string | null
  result: string
}

function isSaveStoryboardsTool(name: string | null | undefined) {
  return /save_storyboard/i.test(String(name || ''))
}

function parseToolResult(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export function storyboardBreakerFailure(opts: {
  liveShotCount: number
  toolResults?: AgentToolResult[]
}): string | null {
  const saves = (opts.toolResults || []).filter((row) => isSaveStoryboardsTool(row.toolName))
  const parsed = saves.map((row) => parseToolResult(row.result))
  const wrote = parsed.some((row) => row && typeof row.error !== 'string' && Number(row.count) > 0)
  if (wrote) return null
  for (let i = parsed.length - 1; i >= 0; i--) {
    const error = typeof parsed[i]?.error === 'string' ? String(parsed[i]?.error).trim() : ''
    if (error) return error
  }
  if (opts.liveShotCount > 0) return null
  return '拆分鏡沒有寫入任何鏡頭，請再試一次。'
}

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
  if (opts.liveShotCount > 0) return null
  for (const row of opts.toolResults || []) {
    if (!isSaveStoryboardsTool(row.toolName)) continue
    const parsed = parseToolResult(row.result)
    const error = typeof parsed?.error === 'string' ? parsed.error.trim() : ''
    if (error) return error
  }
  return '拆分鏡沒有寫入任何鏡頭，請再試一次。'
}

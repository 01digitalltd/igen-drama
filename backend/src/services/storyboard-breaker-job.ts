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
  if (opts.liveShotCount > 0 && saves.length === 0) {
    return '拆分鏡沒有改寫鏡頭，請再試一次。'
  }
  return '拆分鏡沒有寫入任何鏡頭，請再試一次。'
}

function toolNameOf(call: { toolName?: string; payload?: { toolName?: string }; tool?: { id?: string } } | null | undefined) {
  return String(call?.toolName || call?.payload?.toolName || call?.tool?.id || '')
}

function stepCalledSave(step: { toolCalls?: unknown[]; toolResults?: unknown[] } | null | undefined) {
  const calls = [...(step?.toolCalls || []), ...(step?.toolResults || [])] as Array<{
    toolName?: string
    payload?: { toolName?: string }
    tool?: { id?: string }
  }>
  return calls.some((call) => /save_storyboard/i.test(toolNameOf(call)))
}

/**
 * Step 0 must read context. Later steps must save until one save_storyboards
 * call exists, so a text-only turn cannot end the job.
 */
export function storyboardBreakerPrepareStep(args: {
  stepNumber?: number
  steps?: Array<{ toolCalls?: unknown[]; toolResults?: unknown[] }>
}) {
  if ((args.steps || []).some((step) => stepCalledSave(step))) {
    return { toolChoice: 'auto' as const }
  }
  if ((args.stepNumber || 0) <= 0) {
    return { toolChoice: { type: 'tool' as const, toolName: 'read_storyboard_context' } }
  }
  return { toolChoice: { type: 'tool' as const, toolName: 'save_storyboards' } }
}

export function storyboardGenerateDiagnostic(result: {
  finishReason?: unknown
  tripwire?: { reason?: unknown }
  warnings?: unknown
  steps?: unknown
} | null | undefined) {
  const finish = String(result?.finishReason || '').trim()
  const trip = String(result?.tripwire?.reason || '').trim()
  const warnings = (Array.isArray(result?.warnings) ? result.warnings : [])
    .map((warning) => {
      if (typeof warning === 'string') return warning.trim()
      if (warning && typeof warning === 'object') {
        const row = warning as { message?: unknown; type?: unknown }
        return String(row.message || row.type || '').trim()
      }
      return ''
    })
    .filter(Boolean)
    .slice(0, 3)
    .join('; ')
  const steps = Array.isArray(result?.steps) ? result.steps.length : 0
  return [
    finish && `finish=${finish}`,
    trip && `tripwire=${trip}`,
    steps ? `steps=${steps}` : '',
    warnings && `warnings=${warnings.slice(0, 240)}`,
  ].filter(Boolean).join(' ')
}

/** Second user turn when the model reads context and stops without saving. */
export const STORYBOARD_SAVE_FOLLOW_UP = [
  '上一次你只读取了上下文就结束了，没有调用 save_storyboards，所以这一集没有写入分镜。',
  '现在立刻：1) 调用 read_storyboard_context；2) 下一步必须调用 save_storyboards 保存全部分镜。',
  '第一批 replace_existing 必须为 true，每批最多 4 个段落。',
  '不要输出规划、分析或分镜正文。保存完成前不要结束。',
  '若工具返回 error，按错误缩短后再调用 save_storyboards，不要改用文字回复。',
].join('')

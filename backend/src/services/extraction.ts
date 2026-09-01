/**
 * 资产提取任务 — 异步执行，按「集 × 类型」粒度跟踪
 * 角色 / 场景 / 道具 可分别单独提取，同一集的不同类型可并行
 * 任务状态为进程内内存态：后端重启后运行中的任务状态丢失（Agent 调用本身已被中断）
 *
 * Persistence does not depend on the model calling save_* tools. The backend
 * loads the episode script, asks the extractor for structured JSON with tools
 * disabled, then writes via persistDedup*.
 */
import { mastra } from '../mastra/index.js'
import { buildAgentRequestContext } from '../agents/context.js'
import {
  persistDedupCharacters,
  persistDedupProps,
  persistDedupScenes,
} from '../agents/tools/extract-tools.js'
import { db, schema } from '../db/index.js'
import { eq } from '../db/query.js'
import { contentLanguageInstruction } from '../utils/content-language.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { publishEpisodeEvent } from './episode-events.js'
import { z } from 'zod'

export type ExtractTarget = 'characters' | 'scenes' | 'props'
export const EXTRACT_TARGETS: ExtractTarget[] = ['characters', 'scenes', 'props']

export interface ExtractTask {
  status: 'running' | 'done' | 'error'
  started_at: string
  finished_at?: string
  error?: string
}

const tasks = new Map<string, ExtractTask>()
const keyOf = (episodeId: number, target: string) => `${episodeId}:${target}`

const STRUCTURED_INSTRUCTIONS = 'You extract production assets from a formatted screenplay. Return JSON that matches the requested schema. Do not call tools. Do not write a prose summary.'

function extractSchema(target: ExtractTarget) {
  if (target === 'characters') {
    return z.object({
      characters: z.array(z.object({
        name: z.string(),
        role: z.string().optional(),
        appearance: z.string().optional(),
        styling: z.string().optional(),
        description: z.string().optional(),
      })),
    })
  }
  if (target === 'scenes') {
    return z.object({
      scenes: z.array(z.object({
        location: z.string(),
        time: z.string().optional(),
        prompt: z.string().optional(),
        lighting: z.string().optional(),
        description: z.string().optional(),
      })),
    })
  }
  return z.object({
    props: z.array(z.object({
      name: z.string(),
      type: z.string().optional(),
      description: z.string().optional(),
    })),
  })
}

async function countLinked(target: ExtractTarget, episodeId: number): Promise<number> {
  if (target === 'characters') {
    return (await db.select().from(schema.episodeCharacters).where(eq(schema.episodeCharacters.episodeId, episodeId))).length
  }
  if (target === 'scenes') {
    return (await db.select().from(schema.episodeScenes).where(eq(schema.episodeScenes.episodeId, episodeId))).length
  }
  return (await db.select().from(schema.episodeProps).where(eq(schema.episodeProps.episodeId, episodeId))).length
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return null
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = (fenced?.[1] || trimmed).trim()
  try {
    return JSON.parse(raw)
  } catch {
    const startObj = raw.indexOf('{')
    const startArr = raw.indexOf('[')
    const start = startObj === -1 ? startArr : startArr === -1 ? startObj : Math.min(startObj, startArr)
    if (start < 0) return null
    const endObj = raw.lastIndexOf('}')
    const endArr = raw.lastIndexOf(']')
    const end = Math.max(endObj, endArr)
    if (end <= start) return null
    try {
      return JSON.parse(raw.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function normalizeItems(target: ExtractTarget, items: any[]): any[] {
  return items.map((item) => {
    if (!item || typeof item !== 'object') return item
    const record = item as Record<string, unknown>
    if (target === 'characters') {
      return {
        name: firstString(record, ['name', '姓名', '角色名', 'character']),
        role: firstString(record, ['role', '身份', '定位', '角色定位']),
        appearance: firstString(record, ['appearance', '外貌', '样貌', '樣貌']),
        styling: firstString(record, ['styling', '妆造', '妝造', '造型']),
        description: firstString(record, ['description', '描述']),
      }
    }
    if (target === 'scenes') {
      return {
        location: firstString(record, ['location', '地点', '地點', '场景', '場景']),
        time: firstString(record, ['time', '时间', '時間', '时间段', '時間段']),
        prompt: firstString(record, ['prompt', '描述', '场景描述', '場景描述']),
        lighting: firstString(record, ['lighting', '光影', '灯光', '燈光']),
        description: firstString(record, ['description', '描述']),
      }
    }
    return {
      name: firstString(record, ['name', '名称', '名稱', '道具名']),
      type: firstString(record, ['type', '类型', '類型']),
      description: firstString(record, ['description', '描述', '外貌']),
    }
  }).filter((item) => target === 'scenes' ? Boolean(item.location) : Boolean(item.name))
}

function itemsFromPayload(target: ExtractTarget, payload: unknown): any[] {
  if (!payload) return []
  let raw: unknown[] = []
  if (Array.isArray(payload)) raw = payload
  else if (typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    const aliases = target === 'characters'
      ? ['characters', '角色']
      : target === 'scenes'
        ? ['scenes', '场景', '場景']
        : ['props', '道具']
    for (const key of aliases) {
      const nested = record[key]
      if (Array.isArray(nested)) {
        raw = nested
        break
      }
    }
  }
  return normalizeItems(target, raw)
}

async function resolveMaybePromise<T>(value: T | Promise<T> | undefined): Promise<T | undefined> {
  if (value == null) return undefined
  return await Promise.resolve(value)
}

async function payloadFromGenerateResult(result: any): Promise<unknown> {
  const object = await resolveMaybePromise(result?.object)
  if (object) return object
  const steps = result?.steps
  if (Array.isArray(steps)) {
    for (let i = steps.length - 1; i >= 0; i--) {
      const stepObject = await resolveMaybePromise(steps[i]?.object)
      if (stepObject) return stepObject
    }
  }
  const text = await resolveMaybePromise(result?.text)
  return tryParseJson(typeof text === 'string' ? text : '')
}

async function persistExtracted(target: ExtractTarget, episodeId: number, dramaId: number, items: any[]) {
  if (target === 'characters') return persistDedupCharacters(episodeId, dramaId, items)
  if (target === 'scenes') return persistDedupScenes(episodeId, dramaId, items)
  return persistDedupProps(episodeId, dramaId, items)
}

async function loadEpisodeScript(episodeId: number): Promise<string> {
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  return String(ep?.scriptContent || ep?.content || '').trim()
}

async function loadExistingHint(target: ExtractTarget, dramaId: number): Promise<string> {
  if (target === 'characters') {
    const rows = (await db.select().from(schema.characters).where(eq(schema.characters.dramaId, dramaId)))
      .filter(row => !row.deletedAt)
      .map(row => row.name)
      .filter(Boolean)
    return rows.length ? `Existing characters in this project (reuse these names when they match): ${rows.join('、')}` : ''
  }
  if (target === 'scenes') {
    const rows = (await db.select().from(schema.scenes).where(eq(schema.scenes.dramaId, dramaId)))
      .filter(row => !row.deletedAt)
      .map(row => `${row.location}${row.time ? ` | ${row.time}` : ''}`)
      .filter(Boolean)
    return rows.length ? `Existing scenes in this project (reuse location+time when they match): ${rows.join('、')}` : ''
  }
  const rows = (await db.select().from(schema.props).where(eq(schema.props.dramaId, dramaId)))
    .filter(row => !row.deletedAt)
    .map(row => row.name)
    .filter(Boolean)
  return rows.length ? `Existing props in this project (reuse these names when they match): ${rows.join('、')}` : ''
}

function extractUserMessage(target: ExtractTarget, script: string, existingHint: string, locale?: string) {
  const kind = target === 'characters' ? 'characters' : target === 'scenes' ? 'scenes' : 'key props'
  const rules = target === 'characters'
    ? 'Extract every character who has dialogue or an important action. Each item needs name, and preferably role, appearance (look + temperament), and styling (hair, makeup, costume).'
    : target === 'scenes'
      ? 'Extract every distinct location+time. Each item needs location, and preferably time, prompt (space, set dressing), and lighting.'
      : 'Extract only plot-critical props (0-3). Skip everyday objects and set dressing. Empty array is valid. description is physical appearance only.'
  return [
    `Extract ${kind} from the formatted screenplay below. Return JSON only.`,
    rules,
    existingHint,
    contentLanguageInstruction(locale),
    'Screenplay:',
    script.slice(0, 16000),
  ].filter(Boolean).join('\n\n')
}

/** 查询某集三类资产的提取任务状态（未启动过的类型为 null） */
export function getExtractionStatus(episodeId: number): Record<ExtractTarget, ExtractTask | null> {
  const result = {} as Record<ExtractTarget, ExtractTask | null>
  for (const target of EXTRACT_TARGETS) result[target] = tasks.get(keyOf(episodeId, target)) || null
  return result
}

function emitExtractStatus(episodeId: number) {
  publishEpisodeEvent(episodeId, { type: 'extract', payload: getExtractionStatus(episodeId) })
}

/** 启动异步提取任务（立即返回）；同集同类型已在运行时返回 false；可指定文本模型覆盖 */
export function startExtraction(episodeId: number, dramaId: number, target: ExtractTarget, opts: { model?: string; configId?: number; locale?: string } = {}): boolean {
  const key = keyOf(episodeId, target)
  if (tasks.get(key)?.status === 'running') return false

  const task: ExtractTask = { status: 'running', started_at: new Date().toISOString() }
  tasks.set(key, task)
  emitExtractStatus(episodeId)

  logTaskStart('Extract', target, { episodeId, dramaId, model: opts.model || undefined, configId: opts.configId || undefined })
  ;(async () => {
    const agent = mastra.getAgent('extractor')
    if (!agent) throw new Error('提取 Agent 不可用')

    const script = await loadEpisodeScript(episodeId)
    if (!script) throw new Error('本集没有剧本内容，请先完成改写')

    const existingHint = await loadExistingHint(target, dramaId)
    const requestContext = buildAgentRequestContext({
      episodeId,
      dramaId,
      modelOverride: opts.model || undefined,
      textConfigId: opts.configId || undefined,
      locale: opts.locale || undefined,
    })

    logTaskProgress('Extract', `${target}-structured`, { episodeId, scriptLength: script.length })
    const result: any = await agent.generate(
      [{ role: 'user', content: extractUserMessage(target, script, existingHint, opts.locale) }],
      {
        requestContext,
        maxSteps: 1,
        toolChoice: 'none',
        instructions: STRUCTURED_INSTRUCTIONS,
        structuredOutput: {
          schema: extractSchema(target),
          jsonPromptInjection: true,
        },
      },
    )

    const payload = await payloadFromGenerateResult(result)
    const items = itemsFromPayload(target, payload)
    await persistExtracted(target, episodeId, dramaId, items)
    const linked = await countLinked(target, episodeId)
    logTaskProgress('Extract', `${target}-direct-save`, {
      episodeId,
      parsed: items.length,
      linked,
      finishReason: result?.finishReason,
    })

    if (target !== 'props' && linked === 0) {
      throw new Error(`提取完成但未写入任何${target === 'characters' ? '角色' : '场景'}，请确认剧本后重试`)
    }
    return { result, linked, parsed: items.length }
  })()
    .then((summary) => {
      task.status = 'done'
      task.finished_at = new Date().toISOString()
      emitExtractStatus(episodeId)
      logTaskSuccess('Extract', target, {
        episodeId,
        linked: summary.linked,
        parsed: summary.parsed,
        reply: String(summary.result?.text || '').slice(0, 300) || undefined,
      })
    })
    .catch((err: any) => {
      task.status = 'error'
      task.finished_at = new Date().toISOString()
      task.error = err?.message || '提取失败'
      emitExtractStatus(episodeId)
      logTaskError('Extract', target, { episodeId, error: err?.message })
    })
  return true
}

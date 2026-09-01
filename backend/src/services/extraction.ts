/**
 * 资产提取任务 — 异步执行，按「集 × 类型」粒度跟踪
 * 角色 / 场景 / 道具 可分别单独提取，同一集的不同类型可并行
 * 任务状态为进程内内存态：后端重启后运行中的任务状态丢失（Agent 调用本身已被中断）
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

const SAVE_TOOL_ALIASES: Record<ExtractTarget, string[]> = {
  characters: ['save_dedup_characters', 'saveDedupCharacters'],
  scenes: ['save_dedup_scenes', 'saveDedupScenes'],
  props: ['save_dedup_props', 'saveDedupProps'],
}

/** 每类资产的提取指令：限定只提取该类型，并要求与已有数据去重合并 */
const EXTRACT_MESSAGES: Record<ExtractTarget, string> = {
  characters: '请从本集剧本中提取所有角色信息（外貌需融合性格、含妆造），先用 read_existing_characters 读取项目已有角色，同名或近名（带括号定位/别名，如「林小雨（主角）」与「林小雨」）直接复用已有、不要重复创建，再用 save_dedup_characters 保存。本次只提取角色，不要提取场景和道具。',
  scenes: '请从本集剧本中提取所有场景信息（地点、时间、光影等），先用 read_existing_scenes 读取已有场景去重，再用 save_dedup_scenes 保存。本次只提取场景，不要提取角色和道具。',
  props: '请从本集剧本中提取关键道具——必须同时满足：① 直接推动剧情（出现/交接/损坏/发现会引发情节转折，如凶器、信物、关键文件、定情礼物、证据）；② 值得单独生成白底单品图（分镜会给它特写或反复出现）。判定三问任一答"否"即放弃：删掉它剧情依然成立吗？它只是随手使用的日常物品（手机、筷子、水杯）吗？它是场景陈设（桌椅、灯具）吗？宁可少提不要多提，一集通常 0-3 个，超过 3 个只保留最重要的 3 个，没有就一个都不提取（save_dedup_props 传空数组）。description 只记录物品外貌。先用 read_existing_props 读取已有道具去重，再用 save_dedup_props 保存。本次只提取道具，不要提取角色和场景。',
}

function collectToolNames(result: any): string[] {
  const names = new Set<string>()
  const add = (entry: any) => {
    const name = entry?.payload?.toolName || entry?.toolName || entry?.tool?.toolName || entry?.tool?.id || entry?.name
    if (name) names.add(String(name))
  }
  for (const entry of result?.toolCalls || []) add(entry)
  for (const entry of result?.toolResults || []) add(entry)
  for (const step of result?.steps || []) {
    for (const entry of step?.toolCalls || []) add(entry)
    for (const entry of step?.toolResults || []) add(entry)
  }
  return [...names]
}

function calledSaveTool(target: ExtractTarget, toolNames: string[]): boolean {
  const aliases = SAVE_TOOL_ALIASES[target]
  return toolNames.some((name) => aliases.includes(name))
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

function extractUserMessage(target: ExtractTarget, locale?: string) {
  return [
    EXTRACT_MESSAGES[target],
    '必须调用对应工具把结果写入数据库，禁止只回复文字摘要。',
    contentLanguageInstruction(locale),
  ].join('\n\n')
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

function itemsFromPayload(target: ExtractTarget, payload: unknown): any[] {
  if (!payload) return []
  if (Array.isArray(payload)) return payload
  if (typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>
  const nested = record[target]
  if (Array.isArray(nested)) return nested
  return []
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

/** 启动异步提取任务（立即返回）；同集同类型已在运行时返回 false；可指定文本模型覆盖 */
export function startExtraction(episodeId: number, dramaId: number, target: ExtractTarget, opts: { model?: string; configId?: number; locale?: string } = {}): boolean {
  const key = keyOf(episodeId, target)
  if (tasks.get(key)?.status === 'running') return false

  const task: ExtractTask = { status: 'running', started_at: new Date().toISOString() }
  tasks.set(key, task)

  logTaskStart('Extract', target, { episodeId, dramaId, model: opts.model || undefined, configId: opts.configId || undefined })
  ;(async () => {
    const agent = mastra.getAgent('extractor')
    if (!agent) throw new Error('提取 Agent 不可用')
    const requestContext = buildAgentRequestContext({
      episodeId,
      dramaId,
      modelOverride: opts.model || undefined,
      textConfigId: opts.configId || undefined,
      locale: opts.locale || undefined,
    })
    const seenTools = new Set<string>()
    const generateOpts = {
      maxSteps: 20,
      requestContext,
      onStepFinish: (step: any) => {
        const tools = collectToolNames({ toolCalls: step?.toolCalls, toolResults: step?.toolResults, steps: [] })
        for (const name of tools) seenTools.add(name)
        logTaskProgress('Extract', `${target}-step`, {
          episodeId,
          tools: tools.length ? tools.join(',') : undefined,
          text: (step?.text || '').slice(0, 200) || undefined,
        })
      },
    }
    const result: any = await agent.generate(
      [{ role: 'user', content: extractUserMessage(target, opts.locale) }],
      generateOpts,
    )
    for (const name of collectToolNames(result)) seenTools.add(name)

    let linked = await countLinked(target, episodeId)
    if (!calledSaveTool(target, [...seenTools]) && (target === 'props' || linked === 0)) {
      let items = itemsFromPayload(target, result?.object)
      if (!items.length) items = itemsFromPayload(target, tryParseJson(String(result?.text || '')))
      if (!items.length) {
        const script = await loadEpisodeScript(episodeId)
        if (!script) throw new Error('Episode has no script content')
        logTaskProgress('Extract', `${target}-structured-fallback`, { episodeId })
        try {
          const structured: any = await agent.generate(
            [{
              role: 'user',
              content: `从下面的格式化剧本提取${target === 'characters' ? '角色' : target === 'scenes' ? '场景' : '关键道具'}，只返回 JSON。\n\n${script.slice(0, 12000)}`,
            }],
            {
              requestContext,
              maxSteps: 2,
              structuredOutput: {
                schema: target === 'characters'
                  ? z.object({
                      characters: z.array(z.object({
                        name: z.string(),
                        role: z.string().optional(),
                        appearance: z.string().optional(),
                        styling: z.string().optional(),
                        description: z.string().optional(),
                      })),
                    })
                  : target === 'scenes'
                    ? z.object({
                        scenes: z.array(z.object({
                          location: z.string(),
                          time: z.string().optional(),
                          prompt: z.string().optional(),
                          lighting: z.string().optional(),
                          description: z.string().optional(),
                        })),
                      })
                    : z.object({
                        props: z.array(z.object({
                          name: z.string(),
                          type: z.string().optional(),
                          description: z.string().optional(),
                        })),
                      }),
                jsonPromptInjection: true,
              },
            },
          )
          items = itemsFromPayload(target, structured?.object)
          if (!items.length) items = itemsFromPayload(target, tryParseJson(String(structured?.text || '')))
        } catch (err: any) {
          logTaskProgress('Extract', `${target}-structured-fallback-error`, { episodeId, error: err?.message })
        }
      }
      if (items.length || target === 'props') {
        await persistExtracted(target, episodeId, dramaId, items)
        seenTools.add(SAVE_TOOL_ALIASES[target][0])
        linked = await countLinked(target, episodeId)
        logTaskProgress('Extract', `${target}-direct-save`, { episodeId, count: items.length, linked })
      }
    }

    const saved = calledSaveTool(target, [...seenTools])
    linked = await countLinked(target, episodeId)
    if (target !== 'props' && linked === 0) {
      throw new Error(saved
        ? `提取完成但未写入任何${target === 'characters' ? '角色' : '场景'}，请确认剧本后重试`
        : '提取未调用保存工具，请重试')
    }
    if (target === 'props' && !saved) {
      throw new Error('提取未调用保存工具，请重试')
    }
    return { result, toolNames: [...seenTools], linked }
  })()
    .then((summary) => {
      task.status = 'done'
      task.finished_at = new Date().toISOString()
      logTaskSuccess('Extract', target, {
        episodeId,
        steps: summary.result?.steps?.length,
        toolCalls: summary.toolNames.join(',') || undefined,
        linked: summary.linked,
        reply: (summary.result?.text || '').slice(0, 300) || undefined,
      })
    })
    .catch((err: any) => {
      task.status = 'error'
      task.finished_at = new Date().toISOString()
      task.error = err?.message || '提取失败'
      logTaskError('Extract', target, { episodeId, error: err?.message })
    })
  return true
}

/** 查询某集三类资产的提取任务状态（未启动过的类型为 null） */
export function getExtractionStatus(episodeId: number): Record<ExtractTarget, ExtractTask | null> {
  const result = {} as Record<ExtractTarget, ExtractTask | null>
  for (const target of EXTRACT_TARGETS) result[target] = tasks.get(keyOf(episodeId, target)) || null
  return result
}

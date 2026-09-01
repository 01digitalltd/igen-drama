/**
 * 资产提取任务 — 异步执行，按「集 × 类型」粒度跟踪
 * 角色 / 场景 / 道具 可分别单独提取，同一集的不同类型可并行
 * 任务状态为进程内内存态：后端重启后运行中的任务状态丢失（Agent 调用本身已被中断）
 */
import { mastra } from '../mastra/index.js'
import { buildAgentRequestContext } from '../agents/context.js'
import { db, schema } from '../db/index.js'
import { eq } from '../db/query.js'
import { contentLanguageInstruction } from '../utils/content-language.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

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
    const generateOpts = {
      maxSteps: 20,
      requestContext,
      onStepFinish: (step: any) => {
        const tools = (step?.toolCalls || [])
          .map((t: any) => t?.toolName || t?.payload?.toolName)
          .filter(Boolean)
        logTaskProgress('Extract', `${target}-step`, {
          episodeId,
          tools: tools.length ? tools.join(',') : undefined,
          text: (step?.text || '').slice(0, 200) || undefined,
        })
      },
    }
    let result: any = await agent.generate(
      [{ role: 'user', content: extractUserMessage(target, opts.locale) }],
      generateOpts,
    )
    let toolNames = collectToolNames(result)
    if (!calledSaveTool(target, toolNames)) {
      const firstText = String(result?.text || '').slice(0, 4000)
      logTaskProgress('Extract', `${target}-retry-save`, { episodeId, tools: toolNames.join(',') || undefined })
      result = await agent.generate(
        [{
          role: 'user',
          content: [
            `上次没有调用 ${SAVE_TOOL_ALIASES[target][0]}。现在必须立刻调用该工具写入数据库，禁止只回复文字。`,
            firstText ? `以下是你上次提取到的内容，请据此保存：\n${firstText}` : EXTRACT_MESSAGES[target],
          ].join('\n\n'),
        }],
        generateOpts,
      )
      toolNames = [...new Set([...toolNames, ...collectToolNames(result)])]
    }
    const saved = calledSaveTool(target, toolNames)
    const linked = await countLinked(target, episodeId)
    if (target !== 'props' && linked === 0) {
      throw new Error(saved
        ? `提取完成但未写入任何${target === 'characters' ? '角色' : '场景'}，请确认剧本后重试`
        : '提取未调用保存工具，请重试')
    }
    if (target === 'props' && !saved) {
      throw new Error('提取未调用保存工具，请重试')
    }
    return { result, toolNames, linked }
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

/**
 * 最终提示词服务
 * 生图前确保角色/场景/道具已有「最终提示词」：
 * - 角色 → 三视图（character turnaround：正面/侧面/背面）
 * - 场景 → 固定视角 + 前景/中景/后景
 * - 道具 → 白底单品静物（single product shot on pure white background）
 *
 * Persistence does not depend on the model calling save_* tools. The backend
 * asks for structured JSON with tools disabled, then writes via persist*.
 * 失败返回 ''，由调用方回退到本地拼接提示词。
 */
import { eq } from '../db/query.js'
import { db, schema } from '../db/index.js'
import { mastra } from '../mastra/index.js'
import { buildAgentRequestContext } from '../agents/context.js'
import {
  persistCharacterFinalPrompt,
  persistPropFinalPrompt,
  persistSceneFinalPrompt,
} from '../agents/tools/image-prompt-tools.js'
import { logTaskError, logTaskProgress } from '../utils/task-logger.js'
import { withContentLanguage } from '../utils/content-language.js'
import { z } from 'zod'

type CharacterRow = typeof schema.characters.$inferSelect
type SceneRow = typeof schema.scenes.$inferSelect
type PropRow = typeof schema.props.$inferSelect

/** 顶栏选择的文本模型/配置覆盖（不传则跟随 Agent 与文本配置默认） */
export interface PromptAgentOptions { model?: string; configId?: number; locale?: string }

const PROMPT_TIMEOUT_MS = 75_000
const STRUCTURED_INSTRUCTIONS = 'You write a single image prompt for a drama production asset. Return JSON that matches the requested schema. Do not call tools. Do not write a prose summary.'
const promptSchema = z.object({ prompt: z.string() })

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

function promptFromPayload(payload: unknown): string {
  if (!payload) return ''
  if (typeof payload === 'string') return payload.trim()
  if (typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    const value = record.prompt
    if (typeof value === 'string') return value.trim()
  }
  return ''
}

async function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function generateStructuredPrompt(episodeId: number, dramaId: number, message: string, opts?: PromptAgentOptions): Promise<string> {
  const agent = mastra.getAgent('prompt_generator')
  if (!agent) throw new Error('图片提示词 Agent 不可用')
  const requestContext = buildAgentRequestContext({
    episodeId,
    dramaId,
    modelOverride: opts?.model || undefined,
    textConfigId: opts?.configId || undefined,
    locale: opts?.locale || undefined,
  })
  const result: any = await agent.generate(
    [{ role: 'user', content: withContentLanguage(message, opts?.locale) }],
    {
      requestContext,
      maxSteps: 1,
      toolChoice: 'none',
      instructions: STRUCTURED_INSTRUCTIONS,
      structuredOutput: {
        schema: promptSchema,
        jsonPromptInjection: true,
      },
    },
  )
  return promptFromPayload(await payloadFromGenerateResult(result))
}

/** 确保角色拥有三视图最终提示词，返回最终提示词（失败返回 ''）；force 时忽略已有提示词强制重新生成 */
export async function ensureCharacterFinalPrompt(char: CharacterRow, episodeId: number, force = false, opts?: PromptAgentOptions): Promise<string> {
  if (char.finalPrompt && !force) return char.finalPrompt
  try {
    logTaskProgress('FinalPrompt', 'character-generate', { characterId: char.id, episodeId })
    const drafted = await withTimeout(
      generateStructuredPrompt(
        episodeId,
        char.dramaId,
        [
          `为角色「${char.name}」(character_id=${char.id}) 写一张角色设定参考图的最终提示词。`,
          '构图：左侧正脸特写，右侧并列正面、90 度侧面、背面三张等高全身视图；同一张脸、同一发型、同一服装；纯白背景、均匀棚拍光。',
          '只输出纯中文单段描述，不要风格词、不要英文。',
          `身份：${char.role || ''}；外貌：${char.appearance || char.description || ''}；妆造：${char.styling || ''}`,
          'Return JSON {"prompt":"..."} only.',
        ].join('\n'),
        opts,
      ),
      PROMPT_TIMEOUT_MS,
      '',
    )
    if (!drafted) return ''
    return await persistCharacterFinalPrompt(char.dramaId, char.id, drafted)
  } catch (err: any) {
    logTaskError('FinalPrompt', 'character-generate', { characterId: char.id, error: err.message })
    return ''
  }
}

/** 确保场景拥有固定视角（前中后景）最终提示词，返回最终提示词（失败返回 ''）；force 时忽略已有提示词强制重新生成 */
export async function ensureSceneFinalPrompt(scene: SceneRow, episodeId: number, force = false, opts?: PromptAgentOptions): Promise<string> {
  if (scene.finalPrompt && !force) return scene.finalPrompt
  try {
    logTaskProgress('FinalPrompt', 'scene-generate', { sceneId: scene.id, episodeId })
    const drafted = await withTimeout(
      generateStructuredPrompt(
        episodeId,
        scene.dramaId,
        [
          `为场景「${scene.location}」(scene_id=${scene.id}) 写固定机位广角建立镜头的最终提示词。`,
          '这是空镜场景参考图，不是剧情画面：画面中不能有任何人物（含背影、剪影、照片/屏幕里的人），也不能出现可手持或推动剧情的道具。',
          '只描写空间本身：前景/中景/后景、出入口、地面、墙面、固定陈设（家具、灯具、门窗）及其相对位置。',
          '空间描述仅作布局参考；若描述里出现人物、动作或剧情道具，不要写进提示词。',
          '纯中文单段，不要风格词、不要英文，结尾写「画面中没有任何人物，空场景」。',
          `地点：${scene.location}；时间：${scene.time || ''}；空间描述：${scene.prompt || ''}；光影：${scene.lighting || ''}`,
          'Return JSON {"prompt":"..."} only.',
        ].join('\n'),
        opts,
      ),
      PROMPT_TIMEOUT_MS,
      '',
    )
    if (!drafted) return ''
    return await persistSceneFinalPrompt(scene.dramaId, scene.id, drafted)
  } catch (err: any) {
    logTaskError('FinalPrompt', 'scene-generate', { sceneId: scene.id, error: err.message })
    return ''
  }
}

/** 确保道具拥有白底单品最终提示词，返回最终提示词（失败返回 ''）；force 时忽略已有提示词强制重新生成 */
export async function ensurePropFinalPrompt(prop: PropRow, episodeId: number, force = false, opts?: PromptAgentOptions): Promise<string> {
  if (prop.finalPrompt && !force) return prop.finalPrompt
  try {
    logTaskProgress('FinalPrompt', 'prop-generate', { propId: prop.id, episodeId })
    const drafted = await withTimeout(
      generateStructuredPrompt(
        episodeId,
        prop.dramaId,
        [
          `为道具「${prop.name}」(prop_id=${prop.id}) 写白底单品静物的最终提示词。`,
          '纯白背景、单件商品特写、纯中文单段，不要风格词、不要英文。',
          `名称：${prop.name}；类型：${prop.type || ''}；外貌：${prop.description || ''}`,
          'Return JSON {"prompt":"..."} only.',
        ].join('\n'),
        opts,
      ),
      PROMPT_TIMEOUT_MS,
      '',
    )
    if (!drafted) return ''
    return await persistPropFinalPrompt(prop.dramaId, prop.id, drafted)
  } catch (err: any) {
    logTaskError('FinalPrompt', 'prop-generate', { propId: prop.id, error: err.message })
    return ''
  }
}

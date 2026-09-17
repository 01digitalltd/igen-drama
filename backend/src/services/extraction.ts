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
import { isAdPromoCategory } from '../utils/project-category.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { publishEpisodeEvent } from './episode-events.js'
import { agentContextFromAd, loadDramaAdContext } from './brand-logo.js'
import { charactersFromSourceScript, isInternalToolAssetName, itemsFromGenerateResult, scenesFromFormattedScript, summarizeExtractResult } from './extract-payload.js'

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

async function countLinked(target: ExtractTarget, episodeId: number): Promise<number> {
  if (target === 'characters') {
    const links = await db.select().from(schema.episodeCharacters).where(eq(schema.episodeCharacters.episodeId, episodeId))
    const ids = new Set(links.map((row) => row.characterId))
    return (await db.select().from(schema.characters))
      .filter((row) => ids.has(row.id) && !row.deletedAt && !isInternalToolAssetName(row.name || ''))
      .length
  }
  if (target === 'scenes') {
    const links = await db.select().from(schema.episodeScenes).where(eq(schema.episodeScenes.episodeId, episodeId))
    const ids = new Set(links.map((row) => row.sceneId))
    return (await db.select().from(schema.scenes))
      .filter((row) => ids.has(row.id) && !row.deletedAt && !isInternalToolAssetName(row.location || ''))
      .length
  }
  const links = await db.select().from(schema.episodeProps).where(eq(schema.episodeProps.episodeId, episodeId))
  const ids = new Set(links.map((row) => row.propId))
  return (await db.select().from(schema.props))
    .filter((row) => ids.has(row.id) && !row.deletedAt && !isInternalToolAssetName(row.name || ''))
    .length
}

async function persistExtracted(target: ExtractTarget, episodeId: number, dramaId: number, items: any[]) {
  if (target === 'characters') return persistDedupCharacters(episodeId, dramaId, items)
  if (target === 'scenes') return persistDedupScenes(episodeId, dramaId, items)
  return persistDedupProps(episodeId, dramaId, items)
}

async function loadEpisodeScripts(episodeId: number): Promise<{ formatted: string; original: string; script: string }> {
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  const original = String(ep?.content || '').trim()
  const formatted = String(ep?.scriptContent || '').trim()
  return { formatted, original, script: formatted || original }
}

async function loadExistingHint(target: ExtractTarget, dramaId: number): Promise<string> {
  if (target === 'characters') {
    const rows = (await db.select().from(schema.characters).where(eq(schema.characters.dramaId, dramaId)))
      .filter(row => !row.deletedAt && !isInternalToolAssetName(row.name || ''))
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

function extractUserMessage(
  target: ExtractTarget,
  script: string,
  existingHint: string,
  locale?: string,
  projectCategory?: string,
  adForm?: string | null,
  originalDraft?: string,
) {
  const ad = isAdPromoCategory(projectCategory)
  const needsCast = ad && (adForm === 'talent_explain' || adForm === 'drama_promo')
  const kind = target === 'characters' ? 'characters' : target === 'scenes' ? 'scenes' : 'key props'
  const rules = target === 'characters'
    ? (ad
      ? (needsCast
        ? (adForm === 'drama_promo'
          ? 'This is an ad-promo project in short-drama form. You MUST extract the on-camera characters who act or speak in the mini-story. Empty array is not valid.'
          : 'This is an ad-promo project in talent-explain form. You MUST extract the on-camera presenter/expert who speaks. Empty array is not valid.')
        : 'This is an ad-promo project in product-showcase form. Extract every named on-camera person from the formatted screenplay and the original draft (人物/角色 lines, spoken names). Empty array is valid only when neither text names talent.')
      : 'Extract every character who has dialogue or an important action. Each item needs name, and preferably role, appearance (look + temperament), and styling (hair, makeup, costume).')
    : target === 'scenes'
      ? 'Extract every distinct location+time. Each item needs location, and preferably time, prompt (empty space and set dressing only — no people, actions, or handheld plot props), and lighting.'
      : (ad
        ? 'This is an ad-promo project. You MUST include a prop named 品牌Logo with type 品牌Logo (reuse that name if it already exists). Also extract the advertised product if it will get a close-up. Skip unrelated everyday objects. Logo description must say to use the official mark already uploaded in brand settings — do not invent graphic details. Empty array is not valid unless 品牌Logo already exists in the project.'
        : 'Extract only plot-critical props (0-3). Skip everyday objects and set dressing. Empty array is valid. description is physical appearance only.')
  return [
    `Extract ${kind} from the formatted screenplay below. Return JSON only.`,
    `project_category=${ad ? 'ad_promo' : 'short_drama'}`,
    adForm ? `ad_form=${adForm}` : '',
    rules,
    existingHint,
    contentLanguageInstruction(locale),
    'Screenplay:',
    script.slice(0, 16000),
    target === 'characters' && originalDraft && originalDraft !== script
      ? `Original draft (named people here must be extracted even if the formatted screenplay is VO-only):\n${originalDraft.slice(0, 8000)}`
      : '',
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

    const { formatted, original, script } = await loadEpisodeScripts(episodeId)
    if (!script) throw new Error('本集没有剧本内容，请先完成改写')

    const existingHint = await loadExistingHint(target, dramaId)
    const ad = await loadDramaAdContext(dramaId)
    const requestContext = buildAgentRequestContext({
      episodeId,
      dramaId,
      modelOverride: opts.model || undefined,
      textConfigId: opts.configId || undefined,
      locale: opts.locale || undefined,
      ...agentContextFromAd(ad),
    })

    const userMessage = extractUserMessage(target, script, existingHint, opts.locale, ad.genre, ad.spec?.form, original)
    const saveTool = `save_dedup_${target}`
    logTaskProgress('Extract', `${target}-structured`, { episodeId, scriptLength: script.length, originalLength: original.length })
    const forceSave = target === 'scenes'
    const result: any = await agent.generate([{ role: 'user', content: userMessage }], {
      requestContext,
      maxSteps: forceSave ? 4 : 1,
      toolChoice: forceSave ? { type: 'tool', toolName: saveTool } : 'none',
      instructions: forceSave
        ? `Call ${saveTool} with every scene found in the screenplay. Do not call other tools.`
        : 'Return JSON only. Do not call tools. Do not invent names from tool lists. If the original draft names people, include them.',
    })
    let items = itemsFromGenerateResult(target, result)
    if (!items.length && target === 'scenes') {
      items = scenesFromFormattedScript(script)
      if (items.length) logTaskProgress('Extract', 'scenes-header-fallback', { episodeId, parsed: items.length })
    }
    if (!items.length && target === 'characters') {
      items = charactersFromSourceScript([formatted, original].filter(Boolean).join('\n\n'))
      if (items.length) logTaskProgress('Extract', 'characters-source-fallback', { episodeId, parsed: items.length, names: items.map((row) => row.name).join(',') })
    }
    if (!items.length) {
      logTaskProgress('Extract', `${target}-empty-model`, summarizeExtractResult(result))
    }
    await persistExtracted(target, episodeId, dramaId, items)
    const linked = await countLinked(target, episodeId)
    const needsCast = isAdPromoCategory(ad.genre) && (ad.spec?.form === 'talent_explain' || ad.spec?.form === 'drama_promo')
    const namedInSource = charactersFromSourceScript([formatted, original].filter(Boolean).join('\n\n')).length > 0
    logTaskProgress('Extract', `${target}-direct-save`, {
      episodeId,
      parsed: items.length,
      linked,
      ...summarizeExtractResult(result),
    })

    if (target === 'scenes' && linked === 0) {
      throw new Error('提取完成但未写入任何场景，请确认剧本后重试')
    }
    if (target === 'characters' && linked === 0 && (!isAdPromoCategory(ad.genre) || needsCast || namedInSource)) {
      throw new Error('提取完成但未写入任何角色，请确认剧本后重试')
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

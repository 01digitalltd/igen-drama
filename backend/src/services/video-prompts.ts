/**
 * 批量视频提示词任务 — 异步为缺少 video_prompt 的分镜逐个运行 prompt_generator
 * Persistence does not depend on the model calling update_storyboard: the backend
 * inlines shot context, asks for JSON, then writes videoPrompt itself.
 * 进程内内存态：按集跟踪一份任务，运行中不重复启动；重启后状态丢失
 */
import { eq } from '../db/query.js'
import { db, schema } from '../db/index.js'
import { mastra } from '../mastra/index.js'
import { buildAgentRequestContext } from '../agents/context.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess, logTaskWarn } from '../utils/task-logger.js'
import { withContentLanguage } from '../utils/content-language.js'
import { dialogueLanguageInstruction, getDramaDialogueLanguage } from './dialogue-language.js'
import { getDramaVoVoice, rewriteNarratorLabels, voVoiceInstruction } from './vo-voice.js'
import { publishEpisodeEvent } from './episode-events.js'
import { loadEpisodeClipPolicy } from './episode-clip-policy.js'
import { firstConfigModel } from './video-clip-policy.js'
import { now } from '../utils/response.js'
import { buildShotImageRefs } from './storyboard-prompt.js'
import {
  looksLikeVideoPrompt,
  payloadFromGenerateResult,
  summarizeGenerateResult,
  videoPromptFromPayload,
} from './video-prompt-text.js'
import { agentContextFromAd, loadDramaAdContext } from './brand-logo.js'
import { isAdPromoCategory } from '../utils/project-category.js'
import { z } from 'zod'

export interface VideoPromptBatchStatus {
  status: 'running' | 'done' | 'error'
  total: number
  completed: number
  failed: number
  current_storyboard_id?: number
  started_at: string
  finished_at?: string
  error?: string
}

const tasks = new Map<number, VideoPromptBatchStatus>()
const VIDEO_PROMPT_ATTEMPTS = 3
const VIDEO_PROMPT_SCHEMA = z.object({ video_prompt: z.string() })
const STRUCTURED_INSTRUCTIONS = `你是视频提示词工程师。只返回 JSON {"video_prompt":"..."}。不要调用工具，不要输出 JSON 以外的说明。
video_prompt 必须按时间轴分段：Seedance/其他用「0-3秒：」并 @角色名/@场景名/@道具名；Omni 用「[0-3s]」和 image_refs 里的 <IMAGE_REF_N>。
最后一段结束秒数必须等于该分镜 duration。description 的每个【镜头N】映射为 1-2 个连续分段，不要创作新台词。`

async function loadShotPromptContext(storyboard: {
  id: number
  description?: string | null
  atmosphere?: string | null
  duration?: number | null
  sceneId?: number | null
}) {
  const charLinks = await db.select().from(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboard.id))
  const propLinks = await db.select().from(schema.storyboardProps)
    .where(eq(schema.storyboardProps.storyboardId, storyboard.id))
  const characterIds = charLinks.map(link => link.characterId)
  const propIds = propLinks.map(link => link.propId)
  const characters = characterIds.length
    ? (await db.select().from(schema.characters)).filter(row => characterIds.includes(row.id) && !row.deletedAt)
    : []
  const props = propIds.length
    ? (await db.select().from(schema.props)).filter(row => propIds.includes(row.id) && !row.deletedAt)
    : []
  const scene = storyboard.sceneId
    ? (await db.select().from(schema.scenes).where(eq(schema.scenes.id, storyboard.sceneId)))[0] || null
    : null
  return {
    description: String(storyboard.description || '').trim(),
    atmosphere: String(storyboard.atmosphere || '').trim(),
    duration: Number(storyboard.duration) || 0,
    sceneName: scene && !scene.deletedAt ? scene.location : '',
    characterNames: characters.map(row => row.name).filter(Boolean),
    propNames: props.map(row => row.name).filter(Boolean),
    imageRefs: buildShotImageRefs({
      scene: scene && !scene.deletedAt ? { location: scene.location, image_url: scene.imageUrl } : null,
      characters: characters.map(row => ({ name: row.name, image_url: row.imageUrl })),
      props: props.map(row => ({ name: row.name, image_url: row.imageUrl })),
    }),
  }
}

function emitPromptStatus(episodeId: number) {
  publishEpisodeEvent(episodeId, { type: 'prompts', payload: getVideoPromptBatchStatus(episodeId) })
}

async function persistShotVideoPrompt(storyboardId: number, prompt: string) {
  await db.update(schema.storyboards)
    .set({ videoPrompt: prompt, updatedAt: now() })
    .where(eq(schema.storyboards.id, storyboardId))
}

/** 启动批量生成（立即返回）；运行中返回 started:false,total:-1；无待生成分镜返回 started:false,total:0；
 *  传入 storyboardIds 时只处理所选分镜（即使已有提示词也重新生成），否则处理全部缺失提示词的分镜 */
export async function startVideoPromptBatch(
  episodeId: number,
  dramaId: number,
  opts: { model?: string; configId?: number; locale?: string } = {},
  storyboardIds?: number[],
): Promise<{ started: boolean; total: number }> {
  if (tasks.get(episodeId)?.status === 'running') return { started: false, total: -1 }

  const sbs = await db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, episodeId))
    .orderBy(schema.storyboards.storyboardNumber)
  const selectedIds = (storyboardIds || [])
    .map(Number)
    .filter(n => Number.isInteger(n) && n > 0)
  const pending = selectedIds.length
    ? sbs.filter(sb => selectedIds.includes(Number(sb.id)))
    : sbs.filter(sb => !(sb.videoPrompt || '').trim())
  if (!pending.length) return { started: false, total: 0 }

  // 视频模型标签：跟随该集锁定的视频配置，供 Agent 按模型技能生成
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  let videoLabel = '默认'
  if (ep?.videoConfigId) {
    const [cfg] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, ep.videoConfigId))
    if (cfg) videoLabel = `${cfg.name} (${cfg.provider}/${firstConfigModel(cfg.model)})`
  }

  const spoken = await getDramaDialogueLanguage(dramaId)
  const narratorVoice = await getDramaVoVoice(dramaId)
  const clip = await loadEpisodeClipPolicy(episodeId)
  const bounds = clip?.bounds
  const ad = await loadDramaAdContext(dramaId)
  const adHint = isAdPromoCategory(ad.genre)
    ? '当前是广告项目。视频提示词仍按 video-prompt 技能写时间轴（0-3秒：或 [0-3s]），不要改写成脚本或分场；产品/品牌Logo 出镜用 @道具名。'
    : ''

  const task: VideoPromptBatchStatus = {
    status: 'running',
    total: pending.length,
    completed: 0,
    failed: 0,
    started_at: new Date().toISOString(),
  }
  tasks.set(episodeId, task)
  emitPromptStatus(episodeId)

  logTaskStart('VideoPrompt', 'batch', { episodeId, dramaId, total: pending.length, model: opts.model || undefined })
  ;(async () => {
    const agent = mastra.getAgent('prompt_generator')
    if (!agent) throw new Error('视频提示词 Agent 不可用')
    const lastErrors: string[] = []
    for (const sb of pending) {
      task.current_storyboard_id = sb.id
      logTaskProgress('VideoPrompt', 'batch-shot', { episodeId, storyboardId: sb.id, index: task.completed + task.failed + 1, total: task.total })
      try {
        const shot = await loadShotPromptContext(sb)
        if (!shot.description) throw new Error('分镜没有画面描述，无法生成视频提示词')
        let saved = false
        const omni = clip?.videoGeneration?.prompt_skill === 'omni'
        const duration = shot.duration || bounds?.typical || 10
        const endCap = Math.min(duration, bounds?.max || 15)
        for (let attempt = 1; attempt <= VIDEO_PROMPT_ATTEMPTS && !saved; attempt++) {
          const requestContext = buildAgentRequestContext({
            episodeId,
            dramaId,
            modelOverride: opts.model || undefined,
            textConfigId: opts.configId ?? undefined,
            locale: opts.locale || undefined,
            ...agentContextFromAd(ad),
          })
          const result = await agent.generate([{
            role: 'user',
            content: [
              withContentLanguage(`请为分镜 #${sb.storyboardNumber}(ID:${sb.id})写视频提示词(video_prompt)。视频模型:${videoLabel}。prompt_skill:${clip?.videoGeneration?.prompt_skill || 'seedance'}。单段时长必须落在 ${bounds?.min ?? 4}-${bounds?.max ?? 15} 秒（本镜 duration=${duration}s），按 ${bounds?.promptSegment || 3} 秒分段换行，时间轴最后一段的结束秒数不得超过 ${endCap}s。
${omni ? '当前是 Gemini Omni：时间轴写成 [0-3s]，用 image_refs 的 <IMAGE_REF_N> 标记参考图（不要写 @名字，不要写 [# Sources]/[# References]），每段写音频（有对白则写对白；无对白写「无对白」）。' : '当前是 Seedance/其他模型：时间轴写成 0-3秒：，用 @角色名/@场景名/@道具名。'}
${adHint}

分镜画面描述：
${shot.description}
氛围：${shot.atmosphere || '（未填）'}
场景：${shot.sceneName || '（未绑定）'}
角色：${shot.characterNames.join('、') || '无'}
道具：${shot.propNames.join('、') || '无'}
image_refs：${shot.imageRefs.length ? shot.imageRefs.map(ref => `${ref.tag}=${ref.kind}:${ref.name}`).join('；') : '无'}

只返回 JSON {"video_prompt":"..."}。必须根据上面的 description 生成，不要调用工具。`, opts.locale),
              dialogueLanguageInstruction(spoken),
              voVoiceInstruction(narratorVoice),
            ].join('\n\n'),
          }], {
            maxSteps: 1,
            toolChoice: 'none',
            instructions: STRUCTURED_INSTRUCTIONS,
            structuredOutput: {
              schema: VIDEO_PROMPT_SCHEMA,
              jsonPromptInjection: true,
            },
            requestContext,
          })
          const drafted = videoPromptFromPayload(await payloadFromGenerateResult(result))
          if (looksLikeVideoPrompt(drafted)) {
            await persistShotVideoPrompt(sb.id, rewriteNarratorLabels(drafted, narratorVoice))
            saved = true
            break
          }
          logTaskWarn('VideoPrompt', 'batch-shot-retry', {
            storyboardId: sb.id,
            attempt,
            error: 'agent finished but video_prompt was not saved',
            ...summarizeGenerateResult(result),
            text: drafted.slice(0, 240),
          })
        }
        if (saved) task.completed++
        else {
          task.failed++
          lastErrors.push(`#${sb.storyboardNumber}`)
          logTaskError('VideoPrompt', 'batch-shot', { storyboardId: sb.id, error: 'agent finished but video_prompt is empty' })
        }
        emitPromptStatus(episodeId)
      } catch (err: any) {
        task.failed++
        lastErrors.push(`#${sb.storyboardNumber}:${err?.message || 'error'}`)
        logTaskError('VideoPrompt', 'batch-shot', { storyboardId: sb.id, error: err?.message })
        emitPromptStatus(episodeId)
      }
    }
    return lastErrors
  })()
    .then((lastErrors) => {
      if (task.failed > 0 && task.completed === 0) {
        task.status = 'error'
        task.error = `视频提示词生成失败（${task.failed}/${task.total}）${lastErrors?.length ? `：${lastErrors[0]}` : ''}`
      } else {
        task.status = 'done'
      }
      task.finished_at = new Date().toISOString()
      task.current_storyboard_id = undefined
      emitPromptStatus(episodeId)
      logTaskSuccess('VideoPrompt', 'batch', { episodeId, total: task.total, completed: task.completed, failed: task.failed })
    })
    .catch((err: any) => {
      task.status = 'error'
      task.finished_at = new Date().toISOString()
      task.error = err?.message || '批量生成失败'
      emitPromptStatus(episodeId)
      logTaskError('VideoPrompt', 'batch', { episodeId, error: err?.message })
    })
  return { started: true, total: pending.length }
}

export function getVideoPromptBatchStatus(episodeId: number): VideoPromptBatchStatus | null {
  return tasks.get(episodeId) || null
}

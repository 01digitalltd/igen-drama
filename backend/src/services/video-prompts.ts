/**
 * 批量视频提示词任务 — 异步为缺少 video_prompt 的分镜逐个运行 prompt_generator Agent
 * 进程内内存态：按集跟踪一份任务，运行中不重复启动；重启后状态丢失
 */
import { eq } from '../db/query.js'
import { db, schema } from '../db/index.js'
import { mastra } from '../mastra/index.js'
import { buildAgentRequestContext } from '../agents/context.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { withContentLanguage } from '../utils/content-language.js'
import { dialogueLanguageInstruction, getDramaDialogueLanguage } from './dialogue-language.js'
import { publishEpisodeEvent } from './episode-events.js'
import { loadEpisodeClipPolicy } from './episode-clip-policy.js'
import { firstConfigModel } from './video-clip-policy.js'

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

function emitPromptStatus(episodeId: number) {
  publishEpisodeEvent(episodeId, { type: 'prompts', payload: getVideoPromptBatchStatus(episodeId) })
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
  const pending = storyboardIds?.length
    ? sbs.filter(sb => storyboardIds.includes(sb.id))
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
  const clip = await loadEpisodeClipPolicy(episodeId)
  const bounds = clip?.bounds

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
    const requestContext = buildAgentRequestContext({
      episodeId,
      dramaId,
      modelOverride: opts.model || undefined,
      textConfigId: opts.configId || undefined,
      locale: opts.locale || undefined,
    })
    for (const sb of pending) {
      task.current_storyboard_id = sb.id
      logTaskProgress('VideoPrompt', 'batch-shot', { episodeId, storyboardId: sb.id, index: task.completed + task.failed + 1, total: task.total })
      try {
        await agent.generate([{
          role: 'user',
          content: [
            withContentLanguage(`请为分镜 #${sb.storyboardNumber}(ID:${sb.id})生成视频提示词(video_prompt)。视频模型:${videoLabel}。prompt_skill:${clip?.videoGeneration?.prompt_skill || 'seedance'}。单段时长必须落在 ${bounds?.min ?? 4}-${bounds?.max ?? 15} 秒（本镜 duration=${sb.duration || bounds?.typical || 10}s），按 ${bounds?.promptSegment || 3} 秒分段换行，时间轴最后一段的结束秒数不得超过 ${Math.min(Number(sb.duration) || bounds?.max || 15, bounds?.max || 15)}s。
${clip?.videoGeneration?.prompt_skill === 'omni' ? '当前是 Gemini Omni：遵守 Skill video-prompt/omni，时间轴写成 [0-3s]，用该分镜 image_refs 的 <IMAGE_REF_N> 简单标记绑定参考图（不要写 @名字，不要写 [# Sources]/[# References]），每段写音频（有对白则写对白；无对白写「无对白」）。' : '当前是 Seedance/其他模型：遵守 Skill video-prompt，时间轴写成 0-3秒：，用 @角色名/@场景名/@道具名。'}
请先调用 read_storyboard_context 获取该分镜的画面描述(含【镜头N】子镜头与台词/旁白)、氛围、时长、image_refs 及 video_generation 约束，据此生成 video_prompt（段落内允许多镜头切镜，但不跨场景，切镜点对齐分镜 description 的【镜头N】结构）,然后调用 update_storyboard 保存到分镜 ID:${sb.id}。update_storyboard 参数只传 storyboard_id 和 video_prompt 两个键,不要回传该分镜的其他任何字段,不要重新拆分整集。`, opts.locale),
            dialogueLanguageInstruction(spoken),
          ].join('\n\n'),
        }], { maxSteps: 8, requestContext })
        // 以实际落库为准判定成败
        const [fresh] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, sb.id))
        if ((fresh?.videoPrompt || '').trim()) task.completed++
        else {
          task.failed++
          logTaskError('VideoPrompt', 'batch-shot', { storyboardId: sb.id, error: 'agent finished but video_prompt is empty' })
        }
        emitPromptStatus(episodeId)
      } catch (err: any) {
        task.failed++
        logTaskError('VideoPrompt', 'batch-shot', { storyboardId: sb.id, error: err?.message })
        emitPromptStatus(episodeId)
      }
    }
  })()
    .then(() => {
      task.status = 'done'
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

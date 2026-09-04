/**
 * 统一生成任务服务 — 图片/视频生成共用 sys_task 表与同一条生命周期：
 * 创建(processing) → 适配器构建请求 → 同步完成或异步轮询 → 下载落盘 → 回写业务表
 */
import { db, getInsertId, schema } from '../db/index.js'
import { eq } from '../db/query.js'
import { getActiveConfig, getActiveConfigId, getConfigById, isOfficialProvider } from './ai.js'
import { now } from '../utils/response.js'
import { downloadFile, generateImageThumb, readImageAsCompressedDataUrl, saveBase64Image, saveBase64Video } from '../utils/storage.js'
import { isS3Enabled, toVendorFetchableUrl } from '../utils/s3-media.js'
import { extractVideoPoster } from '../utils/video-poster.js'
import { getImageAdapter, getVideoAdapter } from './adapters/registry'
import type { AIConfig } from './adapters/types'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess, logTaskWarn, redactUrl } from '../utils/task-logger.js'
import { toSnakeCase } from '../utils/transform.js'
import { publishEpisodeEvent } from './episode-events.js'
import { getDramaStyleValue } from './style-preset.js'
import { appendVoLanguageDirective, getDramaDialogueLanguage } from './dialogue-language.js'
import { assertSeedanceAllowedForStyle, isRealisticDramaStyle } from './video-model-policy.js'
import { stripCharacterFaceGridPrompt, stripVideoFaceGridPrompt } from './face-grid.js'
import { resolveStoryboardVideoPrompt, resolveVideoGenerationDuration } from './storyboard-prompt.js'

type TaskType = 'image' | 'video'

const taskLabel = (type: TaskType) => (type === 'image' ? 'ImageTask' : 'VideoTask')

// 轮询节奏：图片 5s×120（上限 10 分钟）；视频 10s×300
const POLL_PROFILES: Record<TaskType, { attempts: number; intervalMs: number; maxDurationMs: number | null }> = {
  image: { attempts: 120, intervalMs: 5000, maxDurationMs: 600_000 },
  video: { attempts: 300, intervalMs: 10_000, maxDurationMs: null },
}

/** Extra window after restart so a vendor job that already finished can still be fetched and saved. */
const IMAGE_RESUME_GRACE_MS = 5 * 60 * 1000
const IMAGE_RESUME_MAX_AGE_MS = (POLL_PROFILES.image.maxDurationMs ?? 600_000) + IMAGE_RESUME_GRACE_MS
const VIDEO_RESUME_MAX_AGE_MS = 6 * 60 * 60 * 1000
/** Retry the first vendor submit only if the crash happened quickly; otherwise fail to avoid duplicate jobs. */
const SUBMIT_RETRY_MAX_AGE_MS = 3 * 60 * 1000

const activeProcessors = new Set<number>()
const cancelledTaskIds = new Set<number>()
const videoWaitQueue: number[] = []
const activeVideoIds = new Set<number>()
/** One Gemini/MiniMax clip at a time; extra POSTs wait as status=queued. */
const VIDEO_MAX_CONCURRENT = 1
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'error', 'success', 'done', 'cancelled', 'canceled'])
let pumpingVideoQueue = false

interface GenerateImageParams {
  storyboardId?: number
  dramaId?: number
  episodeId?: number
  sceneId?: number
  characterId?: number
  propId?: number
  prompt: string
  model?: string
  size?: string
  referenceImages?: string[]
  frameType?: string
  configId?: number
}

interface GenerateVideoParams {
  storyboardId?: number
  dramaId?: number
  episodeId?: number
  prompt: string
  model?: string
  referenceMode?: string
  imageUrl?: string
  firstFrameUrl?: string
  lastFrameUrl?: string
  referenceImageUrls?: string[]
  referenceVideoUrls?: string[]
  referenceAudioUrls?: string[]
  generateAudio?: boolean
  duration?: number
  aspectRatio?: string
  resolution?: string
  configId?: number
}

export async function generateImage(params: GenerateImageParams): Promise<number> {
  // 指定配置（集锁定）可能已停用/删除/厂商收敛，失效时回退到当前启用配置，避免生成被旧引用卡死
  let config = params.configId ? await getConfigById(params.configId) : null
  let configId = params.configId ?? null
  if (!config) {
    config = await getActiveConfig('image')
    configId = await getActiveConfigId('image')
  }
  if (!config) throw new Error('未配置图片模型，请先到「设置」页添加并启用 AI 服务')

  const id = await createTask('image', config, {
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    sceneId: params.sceneId,
    characterId: params.characterId,
    propId: params.propId,
    prompt: params.prompt,
    model: params.model || config.model,
  }, {
    size: params.size || '1920x1080',
    frameType: params.frameType,
    referenceImages: params.referenceImages,
    episodeId: params.episodeId,
    configId: configId || undefined,
  })

  logTaskStart('ImageTask', 'enqueue', {
    id,
    provider: config.provider,
    storyboardId: params.storyboardId,
    sceneId: params.sceneId,
    characterId: params.characterId,
    frameType: params.frameType,
    model: params.model || config.model,
  })
  logTaskPayload('ImageTask', 'enqueue params', {
    id,
    config: { provider: config.provider, model: config.model, baseUrl: config.baseUrl },
    params,
  })
  return id
}

export async function generateVideo(params: GenerateVideoParams): Promise<number> {
  const style = await getDramaStyleValue(params.dramaId)
  const videoOpts = isRealisticDramaStyle(style) ? { excludeProviders: ['volcengine'] } : undefined

  // 指定配置（集锁定）可能已停用/删除/厂商收敛，失效时回退到当前启用配置
  let config = params.configId ? await getConfigById(params.configId) : null
  let configId = params.configId ?? null
  if (!config) {
    config = await getActiveConfig('video', videoOpts)
    configId = await getActiveConfigId('video', videoOpts)
  }
  if (!config) throw new Error('未配置视频模型，请先到「设置」页添加并启用 AI 服务')
  assertSeedanceAllowedForStyle(style, config.provider, params.model || config.model)

  let prompt = (params.prompt || '').trim()
  let shotDuration: number | undefined
  if (params.storyboardId) {
    const [sb] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, params.storyboardId))
    if (sb) {
      if (!prompt) prompt = resolveStoryboardVideoPrompt(sb)
      shotDuration = sb.duration || undefined
    }
  }
  const duration = resolveVideoGenerationDuration({
    prompt,
    shotDuration,
    provider: config.provider,
    model: params.model || config.model,
  })
  prompt = appendVoLanguageDirective(prompt, await getDramaDialogueLanguage(params.dramaId))

  const id = await createTask('video', config, {
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    prompt,
    model: params.model || config.model,
  }, {
    referenceMode: params.referenceMode || 'reference',
    imageUrl: params.imageUrl,
    firstFrameUrl: params.firstFrameUrl,
    lastFrameUrl: params.lastFrameUrl,
    referenceImageUrls: params.referenceImageUrls,
    referenceVideoUrls: params.referenceVideoUrls,
    referenceAudioUrls: params.referenceAudioUrls,
    generateAudio: params.generateAudio === false ? 0 : 1,
    duration,
    aspectRatio: params.aspectRatio || '16:9',
    // 保留高分辨率档位透传（MiniMax 768P/2K），火山等适配器内部自行归并
    resolution: ['480p', '720p', '1080p', '2K'].includes(params.resolution || '') ? params.resolution : '720p',
    episodeId: params.episodeId,
    configId: configId || undefined,
  })

  logTaskStart('VideoTask', 'enqueue', {
    id,
    provider: config.provider,
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    referenceMode: params.referenceMode || 'reference',
    duration,
  })
  logTaskPayload('VideoTask', 'enqueue params', {
    id,
    config: { provider: config.provider, model: config.model, baseUrl: config.baseUrl },
    params,
  })
  return id
}

async function createTask(
  type: TaskType,
  config: AIConfig,
  fields: {
    storyboardId?: number
    dramaId?: number
    sceneId?: number
    characterId?: number
    propId?: number
    prompt: string
    model?: string | null
  },
  params: Record<string, unknown>,
): Promise<number> {
  const ts = now()
  const res = await db.insert(schema.sysTask).values({
    type,
    ...fields,
    provider: config.provider,
    params: JSON.stringify(params),
    status: type === 'video' ? 'queued' : 'processing',
    createdAt: ts,
    updatedAt: ts,
  })

  const id = getInsertId(res)
  void emitTaskEvent(id)
  if (type === 'video') enqueueVideo(id)
  else startTaskProcessor(id, type, processTask(id, config))
  return id
}

function enqueueVideo(id: number) {
  if (!Number.isInteger(id) || id <= 0) return
  if (cancelledTaskIds.has(id) || activeVideoIds.has(id) || videoWaitQueue.includes(id)) return
  videoWaitQueue.push(id)
  void pumpVideoQueue()
}

function videoRunningCount() {
  return activeVideoIds.size
}

async function pumpVideoQueue() {
  if (pumpingVideoQueue) return
  pumpingVideoQueue = true
  try {
    while (videoRunningCount() < VIDEO_MAX_CONCURRENT && videoWaitQueue.length) {
      const id = videoWaitQueue.shift()
      if (id == null) break
      if (cancelledTaskIds.has(id) || activeVideoIds.has(id) || activeProcessors.has(id)) continue
      const [row] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
      if (!row || row.type !== 'video' || TERMINAL_TASK_STATUSES.has(String(row.status))) continue
      const config = await resolveConfigForTask(row)
      if (!config) {
        await failTask(id, '找不到可用的视频 AI 配置')
        continue
      }
      startVideoProcessor(id, config)
    }
  } finally {
    pumpingVideoQueue = false
    if (videoWaitQueue.length && videoRunningCount() < VIDEO_MAX_CONCURRENT) {
      void pumpVideoQueue()
    }
  }
}

function startVideoProcessor(id: number, config: AIConfig) {
  if (activeProcessors.has(id) || activeVideoIds.has(id)) return
  activeVideoIds.add(id)
  startTaskProcessor(id, 'video', processTask(id, config).finally(() => {
    activeVideoIds.delete(id)
    void pumpVideoQueue()
  }))
}

async function isCancelled(id: number) {
  if (cancelledTaskIds.has(id)) return true
  const [row] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
  return TERMINAL_TASK_STATUSES.has(String(row?.status)) && /cancel/i.test(String(row?.status || ''))
}

function isAbortError(err: unknown) {
  const name = String((err as { name?: string })?.name || '')
  const message = String((err as { message?: string })?.message || '')
  return name === 'AbortError' || /aborted|abort/i.test(message)
}

async function sleepOrCancel(id: number, ms: number) {
  const step = 500
  let left = ms
  while (left > 0) {
    if (await isCancelled(id)) return true
    await new Promise((r) => setTimeout(r, Math.min(step, left)))
    left -= step
  }
  return isCancelled(id)
}

function startTaskProcessor(id: number, type: TaskType, work: Promise<void>) {
  if (activeProcessors.has(id)) return
  activeProcessors.add(id)
  work
    .catch((err: any) => {
      logTaskError(taskLabel(type), 'process', { id, error: err.message })
      console.error(`${taskLabel(type)} ${id} failed:`, err)
    })
    .finally(() => {
      activeProcessors.delete(id)
    })
}

function parseTaskParams(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {}
  try {
    return JSON.parse(raw) || {}
  } catch {
    return {}
  }
}

async function processTask(id: number, config: AIConfig) {
  try {
    if (await isCancelled(id)) return
    const [record] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
    if (!record) return
    if (TERMINAL_TASK_STATUSES.has(String(record.status))) return
    const type = record.type as TaskType
    if (type === 'video' && record.status === 'queued') {
      await db.update(schema.sysTask)
        .set({ status: 'processing', updatedAt: now() })
        .where(eq(schema.sysTask.id, id))
      await emitTaskEvent(id)
    }
    const label = taskLabel(type)
    const params = parseTaskParams(record.params)
    logTaskProgress(label, 'build-request', {
      id,
      provider: config.provider,
      storyboardId: record.storyboardId,
      sceneId: record.sceneId,
      characterId: record.characterId,
    })

    let url: string, method: string, headers: Record<string, string>, body: unknown

    if (type === 'image') {
      const adapter = getImageAdapter(config.provider)
      const resolvedReferenceImages = await normalizeReferenceImages(params.referenceImages)
      const imagePrompt = record.characterId
        ? stripCharacterFaceGridPrompt(record.prompt || '')
        : record.prompt
      ;({ url, method, headers, body } = adapter.buildGenerateRequest(config, {
        id: record.id,
        model: record.model,
        prompt: imagePrompt,
        size: params.size,
        frameType: params.frameType,
        referenceImages: resolvedReferenceImages.length ? JSON.stringify(resolvedReferenceImages) : null,
      }))
    } else {
      const adapter = getVideoAdapter(config.provider)
      const resolvedImageUrl = await normalizeVideoReferenceUrl(params.imageUrl)
      const resolvedFirstFrameUrl = await normalizeVideoReferenceUrl(params.firstFrameUrl)
      const resolvedLastFrameUrl = await normalizeVideoReferenceUrl(params.lastFrameUrl)
      const resolvedReferenceImageUrls = await normalizeVideoReferenceUrls(params.referenceImageUrls)
      // 参考视频/音频文件较大，不适合 dataURL 内联，需解析为公网可访问 URL
      const resolvedReferenceVideoUrls = await resolvePublicMediaUrls(params.referenceVideoUrls, 'video')
      const resolvedReferenceAudioUrls = await resolvePublicMediaUrls(params.referenceAudioUrls, 'audio')
      let prompt = (record.prompt || '').trim()
      if (!prompt && record.storyboardId) {
        const [sb] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, record.storyboardId))
        if (sb) prompt = resolveStoryboardVideoPrompt(sb)
      }
      const videoPrompt = stripVideoFaceGridPrompt(prompt)
      ;({ url, method, headers, body } = adapter.buildGenerateRequest(config, {
        id: record.id,
        model: record.model,
        prompt: videoPrompt,
        referenceMode: params.referenceMode,
        imageUrl: resolvedImageUrl,
        firstFrameUrl: resolvedFirstFrameUrl,
        lastFrameUrl: resolvedLastFrameUrl,
        referenceImageUrls: resolvedReferenceImageUrls.length ? JSON.stringify(resolvedReferenceImageUrls) : null,
        referenceVideoUrls: resolvedReferenceVideoUrls.length ? JSON.stringify(resolvedReferenceVideoUrls) : null,
        referenceAudioUrls: resolvedReferenceAudioUrls.length ? JSON.stringify(resolvedReferenceAudioUrls) : null,
        generateAudio: params.generateAudio,
        duration: params.duration,
        aspectRatio: params.aspectRatio,
        resolution: params.resolution,
      }))
    }

    logTaskProgress(label, 'request', {
      id,
      provider: config.provider,
      method,
      url: redactUrl(url),
      model: record.model,
    })
    logTaskPayload(label, 'request payload', { id, method, url, headers, body })

    if (await isCancelled(id)) return

    const resp = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600_000),
    })

    if (!resp.ok) throw new Error(`API error ${resp.status}: ${await resp.text()}`)
    const result = await resp.json() as any
    logTaskPayload(label, 'response payload', { id, provider: config.provider, result })

    if (type === 'image') {
      const adapter = getImageAdapter(config.provider)
      const { isAsync, taskId, imageUrl } = adapter.parseGenerateResponse(result)

      if (!isAsync && imageUrl) {
        logTaskProgress(label, 'sync-complete', { id, imageUrl })
        await handleImageComplete(record, imageUrl)
        return
      }

      if (!isAsync && !imageUrl) {
        // 同步模式但无 URL（Gemini 等返回 base64）
        const b64 = adapter.extractImageBase64(result)
        if (b64) {
          logTaskProgress(label, 'sync-base64-complete', { id, mimeType: b64.mimeType })
          await handleImageCompleteBase64(record, b64.data, b64.mimeType)
          return
        }
        throw new Error('No image URL or base64 data in response')
      }

      await markPolling(id, taskId)
      await pollTask(record, config, taskId!)
      return
    }

    const adapter = getVideoAdapter(config.provider)
    const { isAsync, taskId, videoUrl } = adapter.parseGenerateResponse(result)

    if (!isAsync && videoUrl) {
      logTaskProgress(label, 'sync-complete', { id, videoUrl })
      await handleVideoComplete(record, videoUrl, params.duration)
      return
    }

    if (!isAsync) {
      const b64 = adapter.extractVideoBase64(result)
      if (b64) {
        logTaskProgress(label, 'sync-base64-complete', { id, mimeType: b64.mimeType })
        await handleVideoCompleteBase64(record, b64.data, b64.mimeType, params.duration)
        return
      }
      throw new Error('No video URL or base64 data in response')
    }

    await markPolling(id, taskId)
    await pollTask(record, config, taskId!)
  } catch (err: any) {
    if (isAbortError(err) || await isCancelled(id)) return
    await failTask(id, err.message)
  }
}

async function markPolling(id: number, taskId: string | undefined) {
  if (cancelledTaskIds.has(id)) return
  const [row] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
  if (!row || TERMINAL_TASK_STATUSES.has(String(row.status))) return
  await db.update(schema.sysTask)
    .set({ taskId, status: 'processing', updatedAt: now() })
    .where(eq(schema.sysTask.id, id))
  logTaskProgress('SysTask', 'poll-start', { id, taskId })
}

async function failTask(id: number, message: string) {
  if (cancelledTaskIds.has(id)) return
  const [row] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
  if (!row || TERMINAL_TASK_STATUSES.has(String(row.status))) return
  logTaskError('SysTask', 'failed', { id, error: message })
  await db.update(schema.sysTask)
    .set({ status: 'failed', errorMsg: message, updatedAt: now() })
    .where(eq(schema.sysTask.id, id))
  await emitTaskEvent(id)
}

async function episodeIdsForTask(record: SysTaskRecord, params: Record<string, any>): Promise<number[]> {
  const fromParams = Number(params.episodeId || params.episode_id || 0)
  if (Number.isInteger(fromParams) && fromParams > 0) return [fromParams]
  if (record.storyboardId) {
    const [sb] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, record.storyboardId))
    if (sb?.episodeId) return [sb.episodeId]
  }
  const ids = new Set<number>()
  if (record.characterId) {
    const links = await db.select().from(schema.episodeCharacters).where(eq(schema.episodeCharacters.characterId, record.characterId))
    for (const link of links) ids.add(link.episodeId)
  }
  if (record.sceneId) {
    const links = await db.select().from(schema.episodeScenes).where(eq(schema.episodeScenes.sceneId, record.sceneId))
    for (const link of links) ids.add(link.episodeId)
  }
  if (record.propId) {
    const links = await db.select().from(schema.episodeProps).where(eq(schema.episodeProps.propId, record.propId))
    for (const link of links) ids.add(link.episodeId)
  }
  return [...ids]
}

async function emitTaskEvent(id: number) {
  const [row] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
  if (!row) return
  const episodeIds = await episodeIdsForTask(row, parseTaskParams(row.params))
  if (!episodeIds.length) return
  const payload = toSnakeCase(row)
  for (const episodeId of episodeIds) {
    publishEpisodeEvent(episodeId, { type: 'task', payload })
  }
}

type SysTaskRecord = typeof schema.sysTask.$inferSelect

async function pollTask(
  record: SysTaskRecord,
  config: AIConfig,
  taskId: string,
  opts?: { immediate?: boolean },
) {
  const type = record.type as TaskType
  const label = taskLabel(type)
  const profile = POLL_PROFILES[type]
  const adapter = type === 'image' ? getImageAdapter(config.provider) : getVideoAdapter(config.provider)
  const startedAt = Date.now()
  const createdAtMs = Date.parse(record.createdAt || '') || startedAt
  const hardDeadlineMs = type === 'image'
    ? createdAtMs + IMAGE_RESUME_MAX_AGE_MS
    : createdAtMs + VIDEO_RESUME_MAX_AGE_MS

  for (let i = 0; i < profile.attempts; i++) {
    if (await isCancelled(record.id)) return
    if (Date.now() >= hardDeadlineMs) {
      await failTask(record.id, type === 'image'
        ? 'Timeout: Polling exceeded 10 minutes'
        : 'Timeout: video polling exceeded 6 hours')
      return
    }
    if (profile.maxDurationMs && Date.now() - startedAt >= profile.maxDurationMs) {
      await failTask(record.id, 'Timeout: Polling exceeded 10 minutes')
      return
    }
    if (!(opts?.immediate && i === 0)) {
      if (await sleepOrCancel(record.id, profile.intervalMs)) return
    }
    try {
      if (await isCancelled(record.id)) return
      const { url, method, headers } = adapter.buildPollRequest(config, taskId)
      logTaskProgress(label, 'poll-request', {
        id: record.id,
        taskId,
        provider: config.provider,
        method,
        url: redactUrl(url),
        attempt: i + 1,
      })
      const remainingMs = profile.maxDurationMs
        ? Math.max(1_000, profile.maxDurationMs - (Date.now() - startedAt))
        : 600_000
      const resp = await fetch(url, {
        method,
        headers,
        signal: AbortSignal.timeout(remainingMs),
      })
      if (!resp.ok) continue
      const result = await resp.json() as any

      // 图片/视频 PollResponse 结构不同，这里统一按 any 取值后按 type 分支
      const pollResp: any = adapter.parsePollResponse(result)

      if (pollResp.status === 'completed') {
        if (await isCancelled(record.id)) return
        if (type === 'image') {
          if (pollResp.imageUrl) {
            logTaskSuccess(label, 'poll-complete', { id: record.id, taskId, imageUrl: pollResp.imageUrl })
            await handleImageComplete(record, pollResp.imageUrl)
            return
          }
          if (adapter.provider === 'gemini') {
            // Gemini 可能返回 base64
            const b64 = (adapter as ReturnType<typeof getImageAdapter>).extractImageBase64(result)
            if (b64) {
              logTaskSuccess(label, 'poll-base64-complete', { id: record.id, taskId, mimeType: b64.mimeType })
              await handleImageCompleteBase64(record, b64.data, b64.mimeType)
              return
            }
          }
        } else {
          if (pollResp.videoUrl) {
            logTaskSuccess(label, 'poll-complete', { id: record.id, taskId, videoUrl: pollResp.videoUrl })
            await handleVideoComplete(record, pollResp.videoUrl, null)
            return
          }
          const b64 = (adapter as ReturnType<typeof getVideoAdapter>).extractVideoBase64(result)
          if (b64) {
            logTaskSuccess(label, 'poll-base64-complete', { id: record.id, taskId, mimeType: b64.mimeType })
            await handleVideoCompleteBase64(record, b64.data, b64.mimeType, null)
            return
          }
        }
      }
      if (pollResp.status === 'failed') {
        // 上游明确失败（如内容审核拦截）属终态：立即落库，不重试不等待超时
        await failTask(record.id, pollResp.error || 'Generation failed')
        return
      }
    } catch (err: any) {
      if (isAbortError(err) || await isCancelled(record.id)) return
      const exhausted = i === profile.attempts - 1
        || (profile.maxDurationMs != null && Date.now() - startedAt >= profile.maxDurationMs)
      if (exhausted) {
        await failTask(record.id, `Timeout: ${err.message}`)
        return
      }
      logTaskWarn(label, 'poll-retry', { id: record.id, taskId, attempt: i + 1, error: err.message })
    }
  }
  await failTask(record.id, 'Timeout: polling attempts exhausted')
}

async function resolveConfigForTask(record: SysTaskRecord): Promise<AIConfig | null> {
  const params = parseTaskParams(record.params)
  const type = record.type as TaskType
  const configId = Number(params.configId || 0)
  if (Number.isInteger(configId) && configId > 0) {
    const byId = await getConfigById(configId, { allowInactive: true })
    if (byId) return byId
  }

  const provider = String(record.provider || '').trim().toLowerCase()
  if (provider) {
    const rows = (await db.select().from(schema.aiServiceConfigs)
      .where(eq(schema.aiServiceConfigs.serviceType, type))) as Array<{
      id: number
      provider?: string | null
      isActive?: boolean | number | null
      priority?: number | null
    }>
    const matched = rows
      .filter((r) => String(r.provider || '').toLowerCase() === provider && isOfficialProvider(type, r.provider))
      .sort((a, b) => Number(!!b.isActive) - Number(!!a.isActive) || (Number(b.priority) || 0) - (Number(a.priority) || 0))[0]
    if (matched) {
      const byProvider = await getConfigById(Number(matched.id), { allowInactive: true })
      if (byProvider) return byProvider
    }
  }

  return getActiveConfig(type)
}

async function scheduleResume(row: SysTaskRecord): Promise<'poll' | 'retry' | 'fail'> {
  const type = row.type as TaskType
  const id = Number(row.id)
  const createdAtMs = Date.parse(row.createdAt || '') || 0
  const age = createdAtMs ? Date.now() - createdAtMs : Number.POSITIVE_INFINITY
  const maxAge = type === 'image' ? IMAGE_RESUME_MAX_AGE_MS : VIDEO_RESUME_MAX_AGE_MS

  if (!Number.isFinite(age) || age > maxAge) {
    await failTask(id, '服务重启后任务已超时，请重试')
    return 'fail'
  }

  const config = await resolveConfigForTask(row)
  if (!config) {
    await failTask(id, '服务重启后找不到可用的 AI 配置，请重试')
    return 'fail'
  }

  const vendorTaskId = String(row.taskId || '').trim()
  if (vendorTaskId) {
    logTaskStart(taskLabel(type), 'resume-poll', {
      id,
      taskId: vendorTaskId,
      provider: config.provider,
    })
    if (type === 'video') {
      if (!activeVideoIds.has(id) && !activeProcessors.has(id)) {
        activeVideoIds.add(id)
        startTaskProcessor(id, type, pollTask(row, config, vendorTaskId, { immediate: true }).finally(() => {
          activeVideoIds.delete(id)
          void pumpVideoQueue()
        }))
      }
    } else {
      startTaskProcessor(id, type, pollTask(row, config, vendorTaskId, { immediate: true }))
    }
    return 'poll'
  }

  if (type === 'video') {
    logTaskStart(taskLabel(type), 'resume-queue', { id, provider: config.provider })
    enqueueVideo(id)
    return 'retry'
  }

  if (age > SUBMIT_RETRY_MAX_AGE_MS) {
    await failTask(id, '服务重启，生成任务在提交厂商前中断，请重试')
    return 'fail'
  }

  logTaskStart(taskLabel(type), 'resume-retry', { id, provider: config.provider })
  startTaskProcessor(id, type, processTask(id, config))
  return 'retry'
}

export async function cancelGenerationTask(id: number) {
  if (!Number.isInteger(id) || id <= 0) return null
  cancelledTaskIds.add(id)
  const queueIdx = videoWaitQueue.indexOf(id)
  if (queueIdx >= 0) videoWaitQueue.splice(queueIdx, 1)

  const [row] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
  if (!row) return null
  if (TERMINAL_TASK_STATUSES.has(String(row.status))) {
    await emitTaskEvent(id)
    return row
  }

  await db.update(schema.sysTask)
    .set({ status: 'cancelled', errorMsg: 'Cancelled by user', updatedAt: now(), completedAt: now() })
    .where(eq(schema.sysTask.id, id))
  logTaskProgress(taskLabel(row.type as TaskType), 'cancelled', { id, taskId: row.taskId })
  await emitTaskEvent(id)

  const vendorId = String(row.taskId || '').trim()
  if (vendorId && row.type === 'video') {
    try {
      const config = await resolveConfigForTask(row)
      const adapter = config ? getVideoAdapter(config.provider) as { buildCancelRequest?: (c: AIConfig, taskId: string) => { url: string; method: string; headers: Record<string, string>; body?: unknown } } : null
      const req = adapter?.buildCancelRequest?.(config!, vendorId)
      if (req) {
        await fetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: req.body == null ? undefined : JSON.stringify(req.body),
          signal: AbortSignal.timeout(8_000),
        })
      }
    } catch (err: any) {
      logTaskWarn('VideoTask', 'vendor-cancel', { id, error: err?.message })
    }
  }
  const [updated] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
  void pumpVideoQueue()
  return updated || row
}

/** After a process crash, keep polling vendor jobs and persist results. */
export async function resumeInterruptedTasks(): Promise<{ resumed: number; retried: number; failed: number }> {
  const all = (await db.select().from(schema.sysTask)) as SysTaskRecord[]
  const rows = all.filter((row) => {
    if (row.type === 'image') return row.status === 'processing'
    if (row.type === 'video') return row.status === 'processing' || row.status === 'queued'
    return false
  })

  let resumed = 0
  let retried = 0
  let failed = 0

  for (const row of rows) {
    if (row.type !== 'image' && row.type !== 'video') continue
    const id = Number(row.id)
    if (activeProcessors.has(id)) continue
    try {
      const outcome = await scheduleResume(row)
      if (outcome === 'poll') resumed++
      else if (outcome === 'retry') retried++
      else failed++
    } catch (err: any) {
      failed++
      await failTask(id, err?.message || '服务重启后无法恢复生成任务')
    }
  }

  return { resumed, retried, failed }
}

async function handleImageComplete(record: SysTaskRecord, imageUrl: string) {
  if (cancelledTaskIds.has(record.id)) return
  const localPath = await downloadFile(imageUrl, 'images')
  // 列表页缩略图（前端按命名约定推导地址，失败不影响主流程）
  await generateImageThumb(localPath)

  await db.update(schema.sysTask)
    .set({ resultUrl: imageUrl, localPath, status: 'completed', completedAt: now(), updatedAt: now() })
    .where(eq(schema.sysTask.id, record.id))

  logTaskSuccess('ImageTask', 'downloaded', { id: record.id, provider: record.provider, localPath })

  await writeBackImageAssets(record, localPath)
  await emitTaskEvent(record.id)
}

async function handleImageCompleteBase64(record: SysTaskRecord, base64Data: string, mimeType: string) {
  if (cancelledTaskIds.has(record.id)) return
  const localPath = await saveBase64Image(base64Data, mimeType, 'images')
  await generateImageThumb(localPath)

  await db.update(schema.sysTask)
    .set({ localPath, status: 'completed', completedAt: now(), updatedAt: now() })
    .where(eq(schema.sysTask.id, record.id))

  logTaskSuccess('ImageTask', 'saved-base64', { id: record.id, provider: record.provider, mimeType, localPath })

  await writeBackImageAssets(record, localPath)
  await emitTaskEvent(record.id)
}

// 图片完成后回写业务表：分镜(按 frameType)、角色、场景、道具
async function writeBackImageAssets(record: SysTaskRecord, localPath: string) {
  const params = parseTaskParams(record.params)
  if (record.storyboardId) {
    const sbUpdate: Record<string, any> = { updatedAt: now() }
    if (params.frameType === 'first_frame') sbUpdate.firstFrameImage = localPath
    else if (params.frameType === 'last_frame') sbUpdate.lastFrameImage = localPath
    else sbUpdate.composedImage = localPath
    await db.update(schema.storyboards).set(sbUpdate).where(eq(schema.storyboards.id, record.storyboardId))
  }
  if (record.characterId) {
    await db.update(schema.characters).set({ imageUrl: localPath, updatedAt: now() }).where(eq(schema.characters.id, record.characterId))
  }
  if (record.sceneId) {
    await db.update(schema.scenes).set({ imageUrl: localPath, status: 'completed', updatedAt: now() }).where(eq(schema.scenes.id, record.sceneId))
  }
  if (record.propId) {
    await db.update(schema.props).set({ imageUrl: localPath, updatedAt: now() }).where(eq(schema.props.id, record.propId))
  }
}

async function handleVideoCompleteBase64(
  record: SysTaskRecord,
  base64Data: string,
  mimeType: string,
  duration: number | null | undefined,
) {
  if (cancelledTaskIds.has(record.id)) return
  const localPath = await saveBase64Video(base64Data, mimeType, 'videos')
  await extractVideoPoster(localPath)
  await db.update(schema.sysTask)
    .set({ localPath, status: 'completed', completedAt: now(), updatedAt: now() })
    .where(eq(schema.sysTask.id, record.id))

  logTaskSuccess('VideoTask', 'saved-base64', { id: record.id, mimeType, localPath, storyboardId: record.storyboardId })

  if (record.storyboardId) {
    await db.update(schema.storyboards)
      .set({ videoUrl: localPath, duration: duration || undefined, updatedAt: now() })
      .where(eq(schema.storyboards.id, record.storyboardId))
  }
  await emitTaskEvent(record.id)
}

async function handleVideoComplete(record: SysTaskRecord, videoUrl: string, duration: number | null | undefined) {
  if (cancelledTaskIds.has(record.id)) return
  const localPath = await downloadFile(videoUrl, 'videos')
  // 海报帧供列表/封面展示，避免前端为显示首帧缓冲整个视频
  await extractVideoPoster(localPath)
  await db.update(schema.sysTask)
    .set({ resultUrl: videoUrl, localPath, status: 'completed', completedAt: now(), updatedAt: now() })
    .where(eq(schema.sysTask.id, record.id))

  logTaskSuccess('VideoTask', 'downloaded', { id: record.id, localPath, storyboardId: record.storyboardId, duration })

  if (record.storyboardId) {
    await db.update(schema.storyboards)
      .set({ videoUrl: localPath, duration: duration || undefined, updatedAt: now() })
      .where(eq(schema.storyboards.id, record.storyboardId))
  }
  await emitTaskEvent(record.id)
}

// ─── 参考素材归一化 ───────────────────────────────────────────────

async function normalizeReferenceImages(refs: string[] | null | undefined): Promise<string[]> {
  if (!Array.isArray(refs) || !refs.length) return []

  const deduped = Array.from(
    new Set(
      refs
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  )

  const normalized = await Promise.all(deduped.map(async (value) => {
    if (value.startsWith('data:image/')) return value
    if (value.startsWith('static/') || value.startsWith('/static/')) {
      const localPath = value.startsWith('/static/') ? value.slice(1) : value
      try {
        return await readImageAsCompressedDataUrl(localPath, {
          maxWidth: 768,
          maxHeight: 768,
          quality: 68,
        })
      } catch (err) {
        logTaskWarn('ImageTask', 'reference-read-failed', { path: localPath, error: (err as Error).message })
        return null
      }
    }
    return value
  }))

  return normalized.filter((item): item is string => !!item).slice(0, 6)
}

async function normalizeVideoReferenceUrl(value: string | null | undefined): Promise<string | null> {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('data:image/')) return raw
  if (raw.startsWith('static/') || raw.startsWith('/static/')) {
    const localPath = raw.startsWith('/static/') ? raw.slice(1) : raw
    try {
      return await readImageAsCompressedDataUrl(localPath, {
        maxWidth: 768,
        maxHeight: 768,
        quality: 68,
      })
    } catch (err) {
      logTaskWarn('VideoTask', 'reference-read-failed', { path: localPath, error: (err as Error).message })
      return null
    }
  }
  return raw
}

async function normalizeVideoReferenceUrls(refs: string[] | null | undefined): Promise<string[]> {
  if (!Array.isArray(refs) || !refs.length) return []
  const normalized = await Promise.all(
    Array.from(new Set(refs.map((item) => String(item || '').trim()).filter(Boolean))).map((item) => normalizeVideoReferenceUrl(item)),
  )
  return normalized.filter((item): item is string => !!item)
}

/**
 * 将参考视频/音频解析为 Seedance API 可访问的 URL。
 * S3/CloudFront 对象改签成长效 S3 presigned GET（BytePlus 无法带 CloudFront cookie）。
 * 本地 static 路径需要 PUBLIC_BASE_URL 拼成公网地址。
 */
async function resolvePublicMediaUrl(value: string | null | undefined, kind: 'video' | 'audio'): Promise<string | null> {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('data:')) return raw
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    if (isS3Enabled()) return toVendorFetchableUrl(raw)
    return raw
  }
  if (raw.startsWith('static/') || raw.startsWith('/static/')) {
    const base = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')
    if (!base) {
      const label = kind === 'video' ? '视频' : '音频'
      throw new Error(
        `参考${label}为本地路径 ${raw}，但后端未配置 PUBLIC_BASE_URL，Seedance API 无法访问内网地址。` +
        `请在 backend/.env 配置 PUBLIC_BASE_URL（如 https://your-domain.com）后重试，或改用公网 URL。`,
      )
    }
    const p = raw.startsWith('/') ? raw : `/${raw}`
    return `${base}${p}`
  }
  return raw
}

async function resolvePublicMediaUrls(refs: string[] | null | undefined, kind: 'video' | 'audio'): Promise<string[]> {
  if (!Array.isArray(refs) || !refs.length) return []
  const items = Array.from(new Set(refs.map((item) => String(item || '').trim()).filter(Boolean)))
  const resolved = await Promise.all(items.map((item) => resolvePublicMediaUrl(item, kind)))
  return resolved.filter((item): item is string => !!item)
}

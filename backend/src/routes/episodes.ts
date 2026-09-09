import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { and, eq, isNull } from '../db/query.js'
import { db, getInsertId, schema } from '../db/index.js'
import { success, badRequest, now } from '../utils/response.js'
import { toSnakeCaseArray, toSnakeCase } from '../utils/transform.js'
import { getActiveConfigId, isOfficialProvider } from '../services/ai.js'
import { getDramaStyleValue } from '../services/style-preset.js'
import { assertSeedanceAllowedForStyle, isRealisticDramaStyle } from '../services/video-model-policy.js'
import { EXTRACT_TARGETS, getExtractionStatus, startExtraction, type ExtractTarget } from '../services/extraction.js'
import { listAgentJobsForEpisode, toPublicAgentJob } from '../services/agent-jobs.js'
import { subscribeEpisodeEvents } from '../services/episode-events.js'
import { getVideoPromptBatchStatus, startVideoPromptBatch } from '../services/video-prompts.js'
import { loadOwnedDrama, loadOwnedEpisode, ensureEpisodeUuid } from '../utils/ownership.js'
import { toPublicEpisode } from '../utils/public-id.js'
import { getRequestLocale } from '../middleware/request-locale.js'
import { collectShotOverflow, loadEpisodeClipPolicy } from '../services/episode-clip-policy.js'
import { ensureBrandLogoProp, loadDramaCategory } from '../services/brand-logo.js'
import { isAdPromoCategory } from '../utils/project-category.js'

const app = new Hono()

async function episodeFromParam(c: Parameters<typeof loadOwnedEpisode>[0]) {
  const ref = c.req.param('id') || c.req.param('episode_id')
  return loadOwnedEpisode(c, ref)
}

// POST /episodes — Create a new episode
app.post('/', async (c) => {
  const body = await c.req.json()
  if (!body.drama_id) return badRequest(c, 'drama_id required')
  const drama = await loadOwnedDrama(c, body.drama_id)
  const dramaId = drama.id

  const style = await getDramaStyleValue(dramaId)
  const videoOpts = isRealisticDramaStyle(style) ? { excludeProviders: ['volcengine'] } : undefined

  // 图片/视频配置：显式传入优先，缺省时自动锁定当前启用的最高优先级官方配置
  const imageConfigId = body.image_config_id ?? await getActiveConfigId('image')
  const videoConfigId = body.video_config_id ?? await getActiveConfigId('video', videoOpts)
  if (!imageConfigId) return badRequest(c, '未找到启用的图片生成配置，请先在设置中心添加')
  if (!videoConfigId) return badRequest(c, '未找到启用的视频生成配置，请先在设置中心添加')
  if (videoConfigId) {
    const [videoCfg] = await db.select().from(schema.aiServiceConfigs)
      .where(eq(schema.aiServiceConfigs.id, Number(videoConfigId)))
    try {
      assertSeedanceAllowedForStyle(style, videoCfg?.provider, videoCfg?.model)
    } catch (err: any) {
      return badRequest(c, err.message)
    }
  }
  const ts = now()

  // Get next episode number（忽略已软删的集，删除中间集后新集号可复用空位之后的最大值）
  const existing = await db.select().from(schema.episodes)
    .where(and(eq(schema.episodes.dramaId, dramaId), isNull(schema.episodes.deletedAt)))
    .orderBy(schema.episodes.episodeNumber)
  const nextNum = existing.length ? Math.max(...existing.map(e => e.episodeNumber)) + 1 : 1

  const res = await db.insert(schema.episodes).values({
    dramaId,
    episodeNumber: nextNum,
    title: body.title || `第${nextNum}集`,
    imageConfigId,
    videoConfigId,
    // 视频分辨率在创建集时固定（480p/720p），后续可通过 PUT 修改
    resolution: body.resolution === '480p' ? '480p' : '720p',
    targetDurationSeconds: Number.isFinite(Number(body.target_duration_seconds)) && Number(body.target_duration_seconds) > 0
      ? Math.round(Number(body.target_duration_seconds))
      : undefined,
    createdAt: ts,
    updatedAt: ts,
  })

  const [ep] = await db.select().from(schema.episodes)
    .where(eq(schema.episodes.id, getInsertId(res)))
  const created = await ensureEpisodeUuid(ep)
  if (isAdPromoCategory(await loadDramaCategory(dramaId))) {
    await ensureBrandLogoProp(dramaId, created.id)
  }
  return success(c, toPublicEpisode(created, drama, {
    image_config_id: created.imageConfigId,
    video_config_id: created.videoConfigId,
    resolution: created.resolution,
  }))
})

// PUT /episodes/:id - Update episode fields
app.put('/:id', async (c) => {
  const owned = await episodeFromParam(c)
  const id = owned.id
  const body = await c.req.json()

  const allowed = ['content', 'script_content', 'title', 'description', 'status', 'resolution', 'video_config_id', 'target_duration_seconds']
  const updates: Record<string, any> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }
  if (Object.keys(updates).length === 0) return badRequest(c, 'no valid fields')
  if ('resolution' in updates && !['480p', '720p'].includes(updates.resolution)) {
    return badRequest(c, 'resolution 只支持 480p / 720p')
  }

  let nextVideoConfigId: number | undefined
  if ('video_config_id' in updates) {
    const videoConfigId = Number(updates.video_config_id)
    if (!Number.isInteger(videoConfigId) || videoConfigId <= 0) {
      return badRequest(c, 'video_config_id 无效')
    }
    const [cfg] = await db.select().from(schema.aiServiceConfigs)
      .where(eq(schema.aiServiceConfigs.id, videoConfigId))
    if (!cfg?.isActive || cfg.serviceType !== 'video' || !isOfficialProvider('video', cfg.provider)) {
      return badRequest(c, '未找到启用的视频生成配置')
    }
    const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, id))
    try {
      assertSeedanceAllowedForStyle(await getDramaStyleValue(ep?.dramaId), cfg.provider, cfg.model)
    } catch (err: any) {
      return badRequest(c, err.message)
    }
    nextVideoConfigId = videoConfigId
  }

  // Map snake_case to camelCase for drizzle
  const drizzleUpdates: Record<string, any> = { updatedAt: now() }
  if ('content' in updates) drizzleUpdates.content = updates.content
  if ('script_content' in updates) drizzleUpdates.scriptContent = updates.script_content
  if ('title' in updates) drizzleUpdates.title = updates.title
  if ('description' in updates) drizzleUpdates.description = updates.description
  if ('status' in updates) drizzleUpdates.status = updates.status
  if ('resolution' in updates) drizzleUpdates.resolution = updates.resolution
  if (nextVideoConfigId != null) drizzleUpdates.videoConfigId = nextVideoConfigId
  if ('target_duration_seconds' in updates) {
    const seconds = Number(updates.target_duration_seconds)
    if (updates.target_duration_seconds == null || updates.target_duration_seconds === '') {
      drizzleUpdates.targetDurationSeconds = null
    } else if (!Number.isFinite(seconds) || seconds < 1) {
      return badRequest(c, 'target_duration_seconds 无效')
    } else {
      drizzleUpdates.targetDurationSeconds = Math.round(seconds)
    }
  }

  await db.update(schema.episodes).set(drizzleUpdates).where(eq(schema.episodes.id, id))
  const [fresh] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, id))
  const publicFresh = fresh ? await ensureEpisodeUuid(fresh) : owned
  const drama = await loadOwnedDrama(c, publicFresh.dramaId)
  const policy = await loadEpisodeClipPolicy(id)
  const overflow = policy ? await collectShotOverflow(id, policy.bounds) : { durationIds: [], promptIds: [] }
  return success(c, {
    ...toPublicEpisode(publicFresh, drama),
    overflow_shot_ids: overflow.durationIds,
    overflow_prompt_ids: overflow.promptIds,
    clip_policy: policy?.bounds || null,
  })
})

// DELETE /episodes/:id - Soft delete episode（其分镜/生成记录保留但不可达）
app.delete('/:id', async (c) => {
  const ep = await episodeFromParam(c)
  await db.update(schema.episodes).set({ deletedAt: now(), updatedAt: now() })
    .where(eq(schema.episodes.id, ep.id))
  return success(c)
})

// GET /episodes/:id/characters — characters linked to this episode
app.get('/:id/characters', async (c) => {
  const ep = await episodeFromParam(c)
  const episodeId = ep.id
  const links = await db.select().from(schema.episodeCharacters)
    .where(eq(schema.episodeCharacters.episodeId, episodeId))
  const charIds = links.map(l => l.characterId)
  if (!charIds.length) return success(c, [])
  const allChars = await db.select().from(schema.characters)
  const result = allChars.filter(ch => charIds.includes(ch.id) && !ch.deletedAt)
  return success(c, toSnakeCaseArray(result))
})

// GET /episodes/:id/scenes — scenes linked to this episode
app.get('/:id/scenes', async (c) => {
  const ep = await episodeFromParam(c)
  const episodeId = ep.id
  const links = await db.select().from(schema.episodeScenes)
    .where(eq(schema.episodeScenes.episodeId, episodeId))
  const sceneIds = links.map(l => l.sceneId)
  if (!sceneIds.length) return success(c, [])
  const allScenes = await db.select().from(schema.scenes)
  const result = allScenes.filter(sc => sceneIds.includes(sc.id) && !sc.deletedAt)
  return success(c, toSnakeCaseArray(result))
})

// GET /episodes/:id/props — props linked to this episode
app.get('/:id/props', async (c) => {
  const ep = await episodeFromParam(c)
  const episodeId = ep.id
  const links = await db.select().from(schema.episodeProps)
    .where(eq(schema.episodeProps.episodeId, episodeId))
  const propIds = links.map(l => l.propId)
  if (!propIds.length) return success(c, [])
  const allProps = await db.select().from(schema.props)
  const result = allProps.filter(p => propIds.includes(p.id) && !p.deletedAt)
  return success(c, toSnakeCaseArray(result))
})

// POST /episodes/:id/extract — 异步提取资产（target: characters | scenes | props），立即返回；状态经 SSE /events 推送
app.post('/:id/extract', async (c) => {
  const ep = await episodeFromParam(c)
  const body = await c.req.json()
  const target = body.target as ExtractTarget
  if (!EXTRACT_TARGETS.includes(target)) return badRequest(c, 'target 必须是 characters / scenes / props')
  const started = startExtraction(ep.id, ep.dramaId, target, {
    model: body.model || undefined,
    configId: body.config_id ?? undefined,
    locale: getRequestLocale(c, body.locale),
  })
  return success(c, { target, status: 'running', already_running: !started })
})

// GET /episodes/:id/extract-status — 查询三类资产提取任务状态（SSE 断开时的兜底）
app.get('/:id/extract-status', async (c) => {
  const ep = await episodeFromParam(c)
  return success(c, getExtractionStatus(ep.id))
})

// GET /episodes/:id/events — push extract + agent job updates (SSE through the Next.js BFF)
app.get('/:id/events', async (c) => {
  const ep = await episodeFromParam(c)
  const id = ep.id
  c.header('Cache-Control', 'no-cache, no-transform')
  c.header('Connection', 'keep-alive')
  c.header('X-Accel-Buffering', 'no')
  return streamSSE(c, async (stream) => {
    const write = async (event: string, payload: unknown) => {
      if (stream.aborted || stream.closed) return
      await stream.writeSSE({ event, data: JSON.stringify(payload) })
    }
    await write('extract', getExtractionStatus(id))
    for (const job of listAgentJobsForEpisode(id)) {
      await write('job', toPublicAgentJob(job))
    }
    const prompts = getVideoPromptBatchStatus(id)
    if (prompts) await write('prompts', prompts)
    const mergeRows = await db.select().from(schema.videoMerges).where(eq(schema.videoMerges.episodeId, id))
    const latestMerge = mergeRows[mergeRows.length - 1]
    if (latestMerge) await write('merge', toSnakeCase(latestMerge))
    const unsub = subscribeEpisodeEvents(id, (event) => {
      void write(event.type, event.payload)
    })
    const ping = setInterval(() => {
      void write('ping', { t: Date.now() })
    }, 15000)
    await new Promise<void>((resolve) => {
      const done = () => resolve()
      stream.onAbort(done)
      c.req.raw.signal.addEventListener('abort', done, { once: true })
    })
    clearInterval(ping)
    unsub()
  })
})

// POST /episodes/:id/generate-video-prompts — 异步批量为缺少视频提示词的分镜生成（立即返回，前端轮询状态）
app.post('/:id/generate-video-prompts', async (c) => {
  const ep = await episodeFromParam(c)
  const body = await c.req.json().catch(() => ({}))
  const storyboardIds = Array.isArray(body.storyboard_ids)
    ? body.storyboard_ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
    : undefined
  const result = await startVideoPromptBatch(
    ep.id,
    ep.dramaId,
    { model: body.model || undefined, configId: body.config_id ?? undefined, locale: getRequestLocale(c, body.locale) },
    storyboardIds,
  )
  if (result.total === -1) return success(c, { status: 'running', already_running: true })
  if (!result.started) return success(c, { status: 'idle', total: 0 })
  return success(c, { status: 'running', total: result.total })
})

// GET /episodes/:id/video-prompts-status — 查询批量视频提示词任务状态
app.get('/:id/video-prompts-status', async (c) => {
  const ep = await episodeFromParam(c)
  return success(c, getVideoPromptBatchStatus(ep.id))
})

// GET /episodes/:episode_id/storyboards
app.get('/:episode_id/storyboards', async (c) => {
  const ep = await episodeFromParam(c)
  const episodeId = ep.id
  const rows = await db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, episodeId))
    .orderBy(schema.storyboards.storyboardNumber)

  const links = await db.select().from(schema.storyboardCharacters)
  const charIdsByStoryboard = new Map<number, number[]>()
  for (const link of links) {
    const arr = charIdsByStoryboard.get(link.storyboardId) || []
    arr.push(link.characterId)
    charIdsByStoryboard.set(link.storyboardId, arr)
  }

  const propLinks = await db.select().from(schema.storyboardProps)
  const propIdsByStoryboard = new Map<number, number[]>()
  for (const link of propLinks) {
    const arr = propIdsByStoryboard.get(link.storyboardId) || []
    arr.push(link.propId)
    propIdsByStoryboard.set(link.storyboardId, arr)
  }

  const episodeCharLinks = await db.select().from(schema.episodeCharacters)
    .where(eq(schema.episodeCharacters.episodeId, episodeId))
  const episodeCharIds = episodeCharLinks.map(link => link.characterId)
  const allChars = (await db.select().from(schema.characters))
    .filter(ch => episodeCharIds.includes(ch.id) && !ch.deletedAt)

  const episodePropLinks = await db.select().from(schema.episodeProps)
    .where(eq(schema.episodeProps.episodeId, episodeId))
  const episodePropIds = episodePropLinks.map(link => link.propId)
  const allProps = (await db.select().from(schema.props))
    .filter(p => episodePropIds.includes(p.id) && !p.deletedAt)

  return success(c, rows.map((row) => ({
    ...toSnakeCase(row),
    character_ids: charIdsByStoryboard.get(row.id) || [],
    prop_ids: propIdsByStoryboard.get(row.id) || [],
    characters: allChars
      .filter(ch => (charIdsByStoryboard.get(row.id) || []).includes(ch.id))
      .map(ch => toSnakeCase(ch)),
    props: allProps
      .filter(p => (propIdsByStoryboard.get(row.id) || []).includes(p.id))
      .map(p => toSnakeCase(p)),
  })))
})

// GET /episodes/:id/pipeline-status — 流水线进度
// GET /episodes/:id/generation-tasks — 按集聚合 sys_task + video_merges
// sys_task 无 episode_id,通过 storyboard/scene/character/prop 关联键归属到当前集
app.get('/:id/generation-tasks', async (c) => {
  const ep = await episodeFromParam(c)
  const episodeId = ep.id

  const sbs = await db.select().from(schema.storyboards).where(eq(schema.storyboards.episodeId, episodeId))
  const storyboardIds = new Set(sbs.map(s => s.id))

  const epScenes = await db.select().from(schema.episodeScenes).where(eq(schema.episodeScenes.episodeId, episodeId))
  const sceneIds = new Set(epScenes.map(r => r.sceneId))
  // 兼容 scenes.episodeId 直挂的旧数据
  const directScenes = await db.select().from(schema.scenes).where(eq(schema.scenes.episodeId, episodeId))
  directScenes.forEach(s => sceneIds.add(s.id))

  const epChars = await db.select().from(schema.episodeCharacters).where(eq(schema.episodeCharacters.episodeId, episodeId))
  const characterIds = new Set(epChars.map(r => r.characterId))

  const dramaProps = await db.select().from(schema.props).where(eq(schema.props.dramaId, ep.dramaId))
  const propIds = new Set(dramaProps.map(p => p.id))

  const allTasks = await db.select().from(schema.sysTask).where(eq(schema.sysTask.dramaId, ep.dramaId))
  const tasks = allTasks
    .filter(t =>
      (t.storyboardId && storyboardIds.has(t.storyboardId)) ||
      (t.sceneId && sceneIds.has(t.sceneId)) ||
      (t.characterId && characterIds.has(t.characterId)) ||
      (t.propId && propIds.has(t.propId))
    )
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))

  const merges = (await db.select().from(schema.videoMerges)
    .where(and(eq(schema.videoMerges.episodeId, episodeId), isNull(schema.videoMerges.deletedAt))))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 20)

  return success(c, {
    tasks: toSnakeCaseArray(tasks),
    merges: toSnakeCaseArray(merges),
  })
})

app.get('/:id/pipeline-status', async (c) => {
  const ep = await episodeFromParam(c)
  const episodeId = ep.id

  const chars = await db.select().from(schema.characters).where(eq(schema.characters.dramaId, ep.dramaId))
  const scenes = await db.select().from(schema.scenes).where(eq(schema.scenes.dramaId, ep.dramaId))
  const sbs = await db.select().from(schema.storyboards).where(eq(schema.storyboards.episodeId, episodeId))
  const merges = await db.select().from(schema.videoMerges).where(eq(schema.videoMerges.episodeId, episodeId))

  const sbsWithImage = sbs.filter(s => s.composedImage)
  const sbsWithVideo = sbs.filter(s => s.videoUrl)
  const latestMerge = merges[merges.length - 1]

  function stepStatus(done: boolean, partial?: boolean) {
    if (done) return 'done'
    if (partial) return 'partial'
    return 'pending'
  }

  return success(c, {
    episode_id: ep.uuid || String(ep.id),
    steps: {
      script_rewrite: { status: ep.scriptContent ? 'done' : (ep.content ? 'ready' : 'pending') },
      extract_characters: { status: stepStatus(chars.length > 0), count: chars.length },
      extract_scenes: { status: stepStatus(scenes.length > 0), count: scenes.length },
      extract_storyboards: { status: stepStatus(sbs.length > 0), count: sbs.length },
      generate_images: { status: stepStatus(sbsWithImage.length === sbs.length && sbs.length > 0, sbsWithImage.length > 0), completed: sbsWithImage.length, total: sbs.length },
      generate_videos: { status: stepStatus(sbsWithVideo.length === sbs.length && sbs.length > 0, sbsWithVideo.length > 0), completed: sbsWithVideo.length, total: sbs.length },
      merge_episode: { status: latestMerge?.status === 'completed' ? 'done' : (latestMerge ? latestMerge.status : 'pending'), merged_url: latestMerge?.mergedUrl },
    },
  })
})

// GET /episodes/:id — after nested /:id/* routes so Hono keeps those matches
app.get('/:id', async (c) => {
  const ep = await episodeFromParam(c)
  const drama = await loadOwnedDrama(c, ep.dramaId)
  return success(c, toPublicEpisode(ep, drama))
})

export default app

import { Hono } from 'hono'
import { eq, and, isNull } from '../db/query.js'
import { db, schema } from '../db/index.js'
import { success, created, badRequest } from '../utils/response.js'
import { generateImage, generateVideo } from '../services/generation.js'
import { logTaskError, logTaskPayload, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { loadOwnedDrama, loadOwnedStoryboard, shouldScopeToOwner, getOwnerUserId } from '../utils/ownership.js'

const app = new Hono()

type TaskType = 'image' | 'video'

// POST /tasks — 发起生成任务（body.type: image | video）
app.post('/', async (c) => {
  const body = await c.req.json()
  const type = body.type as TaskType
  if (type !== 'image' && type !== 'video') return badRequest(c, 'type 必须为 image 或 video')

  if (type === 'image') {
    if (!body.prompt) return badRequest(c, 'prompt is required')
  } else {
    // 视频生成只保留多模态参考：校验素材上限与必填项
    const imgs = body.reference_image_urls?.length || 0
    const vids = body.reference_video_urls?.length || 0
    const auds = body.reference_audio_urls?.length || 0
    if (imgs > 9 || vids > 3 || auds > 3) {
      return badRequest(c, '参考素材超限：图片≤9、视频≤3、音频≤3')
    }
    if (auds > 0 && imgs + vids === 0) {
      return badRequest(c, '参考音频需要至少 1 个参考图片或视频')
    }
    if (imgs + vids + auds === 0 && !body.prompt) {
      return badRequest(c, '多模态参考模式需要至少一个参考素材或 prompt')
    }
  }

  try {
    if (body.drama_id) await loadOwnedDrama(c, Number(body.drama_id))
    if (body.storyboard_id) await loadOwnedStoryboard(c, Number(body.storyboard_id))
    // 集锁定的生成配置优先于请求指定；视频分辨率同样锁定到集
    let configId: number | undefined = body.config_id
    let episodeResolution: string | undefined
    if (body.storyboard_id) {
      const [sb] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, Number(body.storyboard_id)))
      if (sb) {
        const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId))
        const locked = type === 'image' ? ep?.imageConfigId : ep?.videoConfigId
        if (locked != null) configId = locked
        if (type === 'video' && ep?.resolution) episodeResolution = ep.resolution
      }
    }

    logTaskStart('TaskAPI', 'generate', {
      type,
      storyboardId: body.storyboard_id,
      sceneId: body.scene_id,
      characterId: body.character_id,
      dramaId: body.drama_id,
    })
    logTaskPayload('TaskAPI', 'request body', body)

    const id = type === 'image'
      ? await generateImage({
        storyboardId: body.storyboard_id,
        dramaId: body.drama_id,
        sceneId: body.scene_id,
        characterId: body.character_id,
        prompt: body.prompt,
        model: body.model,
        size: body.size,
        referenceImages: body.reference_images,
        frameType: body.frame_type,
        configId,
      })
      : await generateVideo({
        storyboardId: body.storyboard_id,
        dramaId: body.drama_id,
        prompt: body.prompt,
        model: body.model,
        referenceMode: 'reference',
        referenceImageUrls: body.reference_image_urls,
        referenceVideoUrls: body.reference_video_urls,
        referenceAudioUrls: body.reference_audio_urls,
        generateAudio: body.generate_audio,
        duration: body.duration,
        aspectRatio: body.aspect_ratio,
        resolution: episodeResolution || body.resolution,
        configId,
      })

    const [record] = await db.select().from(schema.sysTask)
      .where(eq(schema.sysTask.id, id))
    logTaskSuccess('TaskAPI', 'generate', { taskId: id, type, provider: record?.provider })
    return created(c, record)
  } catch (err: any) {
    logTaskError('TaskAPI', 'generate', { type, error: err.message })
    return badRequest(c, err.message)
  }
})

async function assertTaskOwned(c: Parameters<typeof loadOwnedDrama>[0], row: typeof schema.sysTask.$inferSelect | undefined) {
  if (!row) return
  if (row.dramaId) await loadOwnedDrama(c, row.dramaId)
  else if (row.storyboardId) await loadOwnedStoryboard(c, row.storyboardId)
}

// GET /tasks — 按 type / storyboard_id / drama_id 过滤
app.get('/', async (c) => {
  const type = c.req.query('type')
  const storyboardId = c.req.query('storyboard_id')
  const dramaId = c.req.query('drama_id')

  if (dramaId) await loadOwnedDrama(c, Number(dramaId))
  if (storyboardId) await loadOwnedStoryboard(c, Number(storyboardId))

  let rows = await db.select().from(schema.sysTask)

  if (type) rows = rows.filter(r => r.type === type)
  if (storyboardId) rows = rows.filter(r => r.storyboardId === Number(storyboardId))
  if (dramaId) rows = rows.filter(r => r.dramaId === Number(dramaId))

  if (shouldScopeToOwner(c) && !dramaId) {
    const owner = getOwnerUserId(c)!
    const owned = await db.select({ id: schema.dramas.id }).from(schema.dramas)
      .where(and(eq(schema.dramas.ownerUserId, owner), isNull(schema.dramas.deletedAt)))
    const allowed = new Set(owned.map(d => d.id))
    rows = rows.filter(r => r.dramaId != null && allowed.has(r.dramaId))
  }

  return success(c, rows)
})

// GET /tasks/:id — 轮询任务状态
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [row] = await db.select().from(schema.sysTask)
    .where(eq(schema.sysTask.id, id))
  await assertTaskOwned(c, row)
  return success(c, row || null)
})

// DELETE /tasks/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [row] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
  await assertTaskOwned(c, row)
  await db.delete(schema.sysTask).where(eq(schema.sysTask.id, id))
  return success(c)
})

export default app

import { Hono } from 'hono'
import { isServiceAuthEnabled } from '../middleware/service-auth.js'
import { getOwnerUserId, OwnershipError } from '../utils/ownership.js'
import { badRequest, forbidden, notFound, success } from '../utils/response.js'
import { unlinkMediaLibraryVideo } from '../services/media-library-video.js'

const app = new Hono()

// POST /media-library/unlink — clear the drama video that a library card points at.
app.post('/unlink', async (c) => {
  if (isServiceAuthEnabled() && !getOwnerUserId(c)) {
    return forbidden(c, 'missing owner')
  }
  let taskId = ''
  try {
    const body = await c.req.json()
    taskId = String(body?.taskId ?? body?.task_id ?? '').trim()
  } catch {
    taskId = ''
  }
  if (!taskId) return badRequest(c, 'taskId is required')

  try {
    const kind = await unlinkMediaLibraryVideo(taskId, getOwnerUserId(c), isServiceAuthEnabled())
    return success(c, { taskId, kind })
  } catch (err) {
    if (err instanceof OwnershipError) return notFound(c, err.message)
    const status = (err as { status?: number })?.status
    if (status === 400) return badRequest(c, err instanceof Error ? err.message : 'bad request')
    throw err
  }
})

export default app

/**
 * Agent 聊天路由 — 异步入队，客户端轮询 job 状态（避免 BFF/Ingress 超时）
 */
import { Hono } from 'hono'
import { validAgentTypes } from '../agents/index.js'
import { success, badRequest, notFound } from '../utils/response.js'
import { getAgentJob, startAgentJob } from '../services/agent-jobs.js'
import { loadOwnedDrama, loadOwnedEpisode } from '../utils/ownership.js'

const app = new Hono()

function publicJob(job: ReturnType<typeof getAgentJob>) {
  if (!job) return null
  return {
    job_id: job.id,
    agent_type: job.agentType,
    status: job.status,
    started_at: job.started_at,
    finished_at: job.finished_at || null,
    error: job.error || null,
    type: job.status === 'done' ? 'done' : job.status,
    text: job.text || '',
    toolCalls: job.toolCalls || [],
    toolResults: job.toolResults || [],
  }
}

// POST /agent/:type/chat — 立即返回 job_id
app.post('/:type/chat', async (c) => {
  const agentType = c.req.param('type')
  if (!validAgentTypes.includes(agentType)) {
    return badRequest(c, `Invalid agent type: ${agentType}`)
  }

  const body = await c.req.json()
  const { message, drama_id, episode_id } = body
  if (!episode_id || !drama_id) {
    return badRequest(c, 'drama_id and episode_id are required')
  }
  if (!message || typeof message !== 'string') {
    return badRequest(c, 'message is required')
  }

  await loadOwnedDrama(c, Number(drama_id))
  const episode = await loadOwnedEpisode(c, Number(episode_id))
  if (episode.dramaId !== Number(drama_id)) {
    return badRequest(c, 'episode does not belong to drama')
  }

  try {
    const job = startAgentJob({
      agentType,
      message,
      dramaId: Number(drama_id),
      episodeId: Number(episode_id),
      model: body.model || undefined,
      configId: body.config_id || undefined,
    })
    return success(c, publicJob(job))
  } catch (err: any) {
    return badRequest(c, err.message || 'Agent execution failed')
  }
})

// GET /agent/:type/jobs/:id — 轮询
app.get('/:type/jobs/:id', async (c) => {
  const agentType = c.req.param('type')
  const id = c.req.param('id')
  if (!validAgentTypes.includes(agentType)) return badRequest(c, 'Invalid agent type')
  const job = getAgentJob(id)
  if (!job || job.agentType !== agentType) return notFound(c, 'job not found')
  await loadOwnedDrama(c, job.dramaId)
  return success(c, publicJob(job))
})

// GET /agent/:type/debug
app.get('/:type/debug', async (c) => {
  const agentType = c.req.param('type')
  if (!validAgentTypes.includes(agentType)) return badRequest(c, 'Invalid agent type')
  return success(c, { agent_type: agentType, valid: true })
})

export default app

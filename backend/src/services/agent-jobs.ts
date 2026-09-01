/**
 * Async agent jobs — POST returns immediately; clients poll GET status.
 * In-memory like extract/video-prompts (replicas=1 until persisted).
 */
import { validAgentTypes } from '../agents/index.js'
import { buildAgentRequestContext } from '../agents/context.js'
import { mastra } from '../mastra/index.js'
import { withContentLanguage } from '../utils/content-language.js'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { publishEpisodeEvent } from './episode-events.js'

export interface AgentJob {
  id: string
  agentType: string
  dramaId: number
  episodeId: number
  status: 'running' | 'done' | 'error'
  started_at: string
  finished_at?: string
  error?: string
  text?: string
  toolCalls?: Array<{ toolName: string | null; args: unknown }>
  toolResults?: Array<{ toolName: string | null; result: string }>
}

const jobs = new Map<string, AgentJob>()

function normalizeToolName(entry: any) {
  return entry?.payload?.toolName
    || entry?.toolName
    || entry?.tool?.toolName
    || entry?.tool?.id
    || entry?.name
    || entry?.type
    || null
}

function normalizeToolResult(entry: any) {
  const result = entry?.payload?.result ?? entry?.result ?? entry?.payload?.output ?? entry?.output ?? entry?.data ?? null
  return typeof result === 'string' ? result : JSON.stringify(result)
}

function newJobId() {
  return `ag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function getAgentJob(id: string): AgentJob | null {
  return jobs.get(id) || null
}

export function listAgentJobsForEpisode(episodeId: number): AgentJob[] {
  return [...jobs.values()].filter((job) => job.episodeId === episodeId)
}

export function toPublicAgentJob(job: AgentJob) {
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

function emitAgentJob(job: AgentJob) {
  publishEpisodeEvent(job.episodeId, { type: 'job', payload: toPublicAgentJob(job) })
}

export function startAgentJob(params: {
  agentType: string
  message: string
  dramaId: number
  episodeId: number
  model?: string
  configId?: number
  locale?: string
}): AgentJob {
  const { agentType, message, dramaId, episodeId } = params
  if (!validAgentTypes.includes(agentType)) {
    throw new Error(`Invalid agent type: ${agentType}`)
  }

  const running = [...jobs.values()].find(
    (j) => j.agentType === agentType && j.episodeId === episodeId && j.status === 'running',
  )
  if (running) return running

  const agent = mastra.getAgent(agentType)
  if (!agent) throw new Error('Agent not found')

  const job: AgentJob = {
    id: newJobId(),
    agentType,
    dramaId,
    episodeId,
    status: 'running',
    started_at: new Date().toISOString(),
  }
  jobs.set(job.id, job)
  emitAgentJob(job)

  logTaskStart('Agent', agentType, { dramaId, episodeId, jobId: job.id, message })
  logTaskPayload('Agent', `${agentType} input`, params)

  const requestContext = buildAgentRequestContext({
    episodeId,
    dramaId,
    modelOverride: params.model || undefined,
    textConfigId: params.configId || undefined,
    locale: params.locale || undefined,
  })
  const startTime = performance.now()

  ;(async () => agent.generate(
    [{ role: 'user', content: withContentLanguage(message, params.locale) }],
    { maxSteps: 20, requestContext },
  ))()
    .then((result: any) => {
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
      const toolCalls = result.toolCalls || []
      const toolResults = result.toolResults || []
      job.toolCalls = toolCalls.map((tc: any) => ({
        toolName: normalizeToolName(tc),
        args: tc?.payload?.args ?? tc?.args ?? tc?.input ?? null,
      }))
      job.toolResults = toolResults.map((tr: any) => ({
        toolName: normalizeToolName(tr),
        result: normalizeToolResult(tr),
      }))
      job.text = result.text || ''
      job.status = 'done'
      job.finished_at = new Date().toISOString()
      emitAgentJob(job)
      logTaskSuccess('Agent', agentType, { elapsedSeconds: elapsed, jobId: job.id })
      logTaskProgress('Agent', 'tool-summary', {
        agentType,
        toolCalls: job.toolCalls.map((tc) => tc.toolName),
        toolResults: job.toolResults.map((tr) => tr.toolName),
      })
    })
    .catch((err: any) => {
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
      job.status = 'error'
      job.finished_at = new Date().toISOString()
      job.error = err?.message || 'Agent execution failed'
      emitAgentJob(job)
      logTaskError('Agent', agentType, { elapsedSeconds: elapsed, jobId: job.id, error: job.error })
      console.error(err.stack || err)
    })

  return job
}

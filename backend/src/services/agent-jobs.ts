/**
 * Async agent jobs — POST returns immediately; clients poll GET status.
 * In-memory like extract/video-prompts (replicas=1 until persisted).
 */
import { validAgentTypes } from '../agents/index.js'
import { buildAgentRequestContext } from '../agents/context.js'
import { db, schema } from '../db/index.js'
import { eq } from '../db/query.js'
import { mastra } from '../mastra/index.js'
import { withContentLanguage } from '../utils/content-language.js'
import { agentJobErrorMessage } from '../utils/provider-error.js'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess, logTaskWarn } from '../utils/task-logger.js'
import { publishEpisodeEvent } from './episode-events.js'
import { agentContextFromAd, loadDramaAdContext } from './brand-logo.js'
import {
  STORYBOARD_SAVE_FOLLOW_UP,
  storyboardBreakerFailure,
  storyboardBreakerPrepareStep,
  storyboardGenerateDiagnostic,
  type AgentToolResult,
} from './storyboard-breaker-job.js'

async function countLiveStoryboards(episodeId: number) {
  const rows = await db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, episodeId))
  return rows.filter((row) => !row.deletedAt).length
}

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

function flattenGenerateResult(result: any) {
  const toolCalls = [...(result?.toolCalls || [])]
  const toolResults = [...(result?.toolResults || [])]
  for (const step of result?.steps || []) {
    for (const call of step?.toolCalls || []) toolCalls.push(call)
    for (const row of step?.toolResults || []) toolResults.push(row)
  }
  return { ...result, toolCalls, toolResults }
}

function normalizeGenerateToolResults(result: any): AgentToolResult[] {
  const toolResults = flattenGenerateResult(result).toolResults || []
  return toolResults.map((tr: any) => ({
    toolName: normalizeToolName(tr),
    result: normalizeToolResult(tr),
  }))
}

const storyboardGenerateOptions = {
  maxSteps: 20,
  prepareStep: storyboardBreakerPrepareStep,
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

  const startTime = performance.now()

  ;(async () => {
    const ad = await loadDramaAdContext(dramaId)
    const requestContext = buildAgentRequestContext({
      episodeId,
      dramaId,
      modelOverride: params.model || undefined,
      textConfigId: params.configId || undefined,
      locale: params.locale || undefined,
      ...agentContextFromAd(ad),
    })
    const userMessage = withContentLanguage(message, params.locale)
    const generateOptions = agentType === 'storyboard_breaker'
      ? { ...storyboardGenerateOptions, requestContext }
      : { maxSteps: 20, requestContext }
    let result = flattenGenerateResult(await agent.generate(
      [{ role: 'user', content: userMessage }],
      generateOptions,
    ))
    if (agentType !== 'storyboard_breaker') return result
    const preview = storyboardBreakerFailure({
      liveShotCount: await countLiveStoryboards(episodeId),
      toolResults: normalizeGenerateToolResults(result),
    })
    if (!preview) return result
    logTaskWarn('Agent', 'storyboard_breaker-retry', {
      episodeId,
      jobId: job.id,
      reason: preview,
      text: String(result?.text || '').slice(0, 400),
      diagnostic: storyboardGenerateDiagnostic(result),
    })
    const retry = flattenGenerateResult(await agent.generate(
      [
        { role: 'user', content: userMessage },
        { role: 'assistant', content: '已读取分镜上下文，但还没有调用 save_storyboards。' },
        { role: 'user', content: withContentLanguage(STORYBOARD_SAVE_FOLLOW_UP, params.locale) },
      ],
      generateOptions,
    ))
    return flattenGenerateResult({
      ...retry,
      text: retry?.text || result?.text || '',
      finishReason: retry?.finishReason || result?.finishReason,
      warnings: [...(result?.warnings || []), ...(retry?.warnings || [])],
      tripwire: retry?.tripwire || result?.tripwire,
      steps: [...(result?.steps || []), ...(retry?.steps || [])],
      toolCalls: [...(result?.toolCalls || []), ...(retry?.toolCalls || [])],
      toolResults: [...(result?.toolResults || []), ...(retry?.toolResults || [])],
    })
  })()
    .then(async (result: any) => {
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
      if (agentType === 'storyboard_breaker') {
        try {
          const liveShotCount = await countLiveStoryboards(episodeId)
          const failure = storyboardBreakerFailure({
            liveShotCount,
            toolResults: job.toolResults,
          })
          if (failure) {
            job.status = 'error'
            const diagnostic = storyboardGenerateDiagnostic(result)
            job.error = diagnostic ? `${failure}（${diagnostic}）` : failure
          }
        } catch (err: any) {
          job.status = 'error'
          job.error = err?.message || '拆分鏡沒有寫入任何鏡頭，請再試一次。'
        }
      }
      emitAgentJob(job)
      if (job.status === 'error') {
        logTaskError('Agent', agentType, {
          elapsedSeconds: elapsed,
          jobId: job.id,
          error: job.error,
          text: String(job.text || '').slice(0, 400),
        })
      } else {
        logTaskSuccess('Agent', agentType, { elapsedSeconds: elapsed, jobId: job.id })
      }
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
      job.error = agentJobErrorMessage(err)
      emitAgentJob(job)
      logTaskError('Agent', agentType, { elapsedSeconds: elapsed, jobId: job.id, error: job.error })
      console.error(err.stack || err)
    })

  return job
}

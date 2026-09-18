import { db, schema } from '../db/index.js'
import { eq } from '../db/query.js'
import { toSnakeCase } from '../utils/transform.js'
import { listAgentJobsForEpisode, toPublicAgentJob } from './agent-jobs.js'
import type { EpisodeEvent } from './episode-events.js'
import { getExtractionStatus } from './extraction.js'
import { getVideoPromptBatchStatus } from './video-prompts.js'

export async function collectEpisodePushEvents(episodeId: number): Promise<EpisodeEvent[]> {
  const events: EpisodeEvent[] = [
    { type: 'extract', payload: getExtractionStatus(episodeId) },
  ]
  for (const job of listAgentJobsForEpisode(episodeId)) {
    events.push({ type: 'job', payload: toPublicAgentJob(job) })
  }
  const prompts = getVideoPromptBatchStatus(episodeId)
  if (prompts) events.push({ type: 'prompts', payload: prompts })
  const mergeRows = await db.select().from(schema.videoMerges).where(eq(schema.videoMerges.episodeId, episodeId))
  const latestMerge = mergeRows[mergeRows.length - 1]
  if (latestMerge) events.push({ type: 'merge', payload: toSnakeCase(latestMerge) })
  return events
}

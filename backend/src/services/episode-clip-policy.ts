import { eq } from '../db/query.js'
import { db, schema } from '../db/index.js'
import { getActiveConfig, getConfigById } from './ai.js'
import { parseVideoPromptDurationSeconds } from './storyboard-prompt.js'
import {
  clipDurationBounds,
  durationExceedsMax,
  toAgentVideoGeneration,
  type ClipDurationPolicy,
} from './video-clip-policy.js'

export type EpisodeClipPolicy = {
  episodeId: number
  configId: number | null
  provider: string
  model: string
  bounds: ClipDurationPolicy
  targetDurationSeconds: number | null
  videoGeneration: ReturnType<typeof toAgentVideoGeneration>
}

export async function loadEpisodeClipPolicy(episodeId: number): Promise<EpisodeClipPolicy | null> {
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  if (!ep) return null
  const config = ep.videoConfigId
    ? await getConfigById(Number(ep.videoConfigId), { allowInactive: true })
    : await getActiveConfig('video')
  const provider = config?.provider || ''
  const model = config?.model || ''
  const bounds = clipDurationBounds(provider, model)
  const targetDurationSeconds = Number(ep.targetDurationSeconds)
  return {
    episodeId,
    configId: ep.videoConfigId ?? null,
    provider,
    model,
    bounds,
    targetDurationSeconds: Number.isFinite(targetDurationSeconds) && targetDurationSeconds > 0
      ? Math.round(targetDurationSeconds)
      : null,
    videoGeneration: toAgentVideoGeneration({
      provider,
      model,
      configId: ep.videoConfigId ?? null,
      bounds,
      targetDurationSeconds: Number.isFinite(targetDurationSeconds) && targetDurationSeconds > 0
        ? Math.round(targetDurationSeconds)
        : null,
    }),
  }
}

export async function collectShotOverflow(episodeId: number, bounds: ClipDurationPolicy) {
  const rows = await db.select().from(schema.storyboards).where(eq(schema.storyboards.episodeId, episodeId))
  const durationIds: number[] = []
  const promptIds: number[] = []
  for (const row of rows) {
    if (row.deletedAt) continue
    if (durationExceedsMax(row.duration, bounds.max)) durationIds.push(row.id)
    const promptSeconds = parseVideoPromptDurationSeconds(row.videoPrompt)
    if (durationExceedsMax(promptSeconds, bounds.max)) promptIds.push(row.id)
  }
  return { durationIds, promptIds }
}

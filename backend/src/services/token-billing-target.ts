/**
 * Record ids must match i-gen-nextjs app/lib/api/drama-billing.ts.
 * The browser settle and this server settle share one idempotency key.
 * Seconds come from the requested params.duration (else 5), not a probed
 * file length, so both callers send the same videoSeconds.
 */

export type DramaBillingTask = {
  id: number
  type: string
  storyboardId?: number | null
  characterId?: number | null
  sceneId?: number | null
  propId?: number | null
  params?: string | null
}

export type DramaBillingTarget = {
  serviceName: 'aiVideo' | 'aiImage'
  recordId: string
  videoSeconds?: number
}

export function dramaBillingTarget(task: DramaBillingTask): DramaBillingTarget | null {
  const kind = String(task.type || '').toLowerCase()
  if (kind === 'video') {
    const shot = Number(task.storyboardId)
    const recordId = Number.isFinite(shot) && shot > 0 ? `drama-shot-${shot}` : `drama-task-${task.id}`
    return { serviceName: 'aiVideo', recordId, videoSeconds: videoSecondsFromParams(task.params) }
  }
  if (kind !== 'image') return null
  if (isStoryboardStill(task)) return null
  return { serviceName: 'aiImage', recordId: imageRecordId(task) }
}

function imageRecordId(task: DramaBillingTask): string {
  const character = Number(task.characterId)
  if (Number.isFinite(character) && character > 0) return `drama-character-${character}`
  const scene = Number(task.sceneId)
  if (Number.isFinite(scene) && scene > 0) return `drama-scene-${scene}`
  const prop = Number(task.propId)
  if (Number.isFinite(prop) && prop > 0) return `drama-prop-${prop}`
  return `drama-task-${task.id}`
}

function isStoryboardStill(task: DramaBillingTask): boolean {
  const shot = Number(task.storyboardId)
  if (!Number.isFinite(shot) || shot <= 0) return false
  const character = Number(task.characterId)
  const scene = Number(task.sceneId)
  const prop = Number(task.propId)
  const owned = (value: number) => Number.isFinite(value) && value > 0
  return !owned(character) && !owned(scene) && !owned(prop)
}

function videoSecondsFromParams(raw: string | null | undefined): number {
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { duration?: unknown }
      const seconds = Number(parsed?.duration)
      if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds)
    } catch {
      // Fall through to the same default the browser uses.
    }
  }
  return 5
}

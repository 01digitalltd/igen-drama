/**
 * Pure rules for copying /ai-video clips into the media library catalog.
 * IO (S3, Mongo) lives in media-library-video.ts so these stay testable.
 */
import { ObjectId } from 'mongodb'

export const MEDIA_LIBRARY_COLLECTION = 'volcenginemedias'
export const MEDIA_LIBRARY_SOURCE = 'ai-video'

export function shotTaskId(storyboardId: number): string {
  return `drama-sb-${storyboardId}`
}

export function mergeTaskId(episodeId: number): string {
  return `drama-ep-${episodeId}-merge`
}

export type LibraryTaskRef =
  | { kind: 'shot'; storyboardId: number; taskId: string }
  | { kind: 'merge'; episodeId: number; taskId: string }

export function parseLibraryTaskId(taskId: string): LibraryTaskRef | null {
  const raw = String(taskId || '').trim()
  const shot = /^drama-sb-(\d+)$/.exec(raw)
  if (shot) {
    const storyboardId = Number(shot[1])
    if (!Number.isInteger(storyboardId) || storyboardId <= 0) return null
    return { kind: 'shot', storyboardId, taskId: raw }
  }
  const merge = /^drama-ep-(\d+)-merge$/.exec(raw)
  if (merge) {
    const episodeId = Number(merge[1])
    if (!Number.isInteger(episodeId) || episodeId <= 0) return null
    return { kind: 'merge', episodeId, taskId: raw }
  }
  return null
}

/** Stable copy destination. Regenerating the same shot overwrites these objects. */
export function libraryObjectKeys(taskId: string): { videoKey: string; posterKey: string } {
  return {
    videoKey: `videos/${taskId}/video.mp4`,
    posterKey: `videos/${taskId}/poster.jpg`,
  }
}

export function siblingPosterKey(videoKey: string): string {
  return String(videoKey || '').replace(/\.[^./?#]+(?=($|\?|#))/, '_poster.jpg')
}

export function ownerObjectId(ownerUserId: string | null | undefined): ObjectId | null {
  const raw = String(ownerUserId || '').trim()
  if (!/^[a-fA-F0-9]{24}$/.test(raw)) return null
  return new ObjectId(raw)
}

export function shotLibraryTitle(storyboardNumber: number, title?: string | null): string {
  const n = Number(storyboardNumber) || 0
  const name = String(title || '').trim()
  return name ? `分鏡 ${n} ${name}` : `分鏡 ${n}`
}

export function mergeLibraryTitle(episodeTitle?: string | null): string {
  const name = String(episodeTitle || '').trim() || '影片'
  return `${name} 成片`
}

export type LibraryUpsertInput = {
  taskId: string
  ownerUserId: string
  videoUrl: string
  videoKey: string
  posterUrl?: string | null
  posterKey?: string | null
  bucket: string
  title: string
  duration?: number | null
  kind: 'shot' | 'merge'
  dramaId: number
  episodeId: number
  storyboardId?: number | null
  now?: Date
}

export function libraryMediaUpsert(input: LibraryUpsertInput): {
  filter: { taskId: string }
  update: { $set: Record<string, unknown>; $setOnInsert: Record<string, unknown> }
} | null {
  const userId = ownerObjectId(input.ownerUserId)
  if (!userId) return null
  const now = input.now || new Date()
  const inputParams: Record<string, unknown> = {
    source: MEDIA_LIBRARY_SOURCE,
    kind: input.kind,
    dramaId: input.dramaId,
    episodeId: input.episodeId,
  }
  if (input.kind === 'shot' && input.storyboardId) {
    inputParams.storyboardId = input.storyboardId
  }
  const set: Record<string, unknown> = {
    userId,
    mediaType: 'video',
    taskId: input.taskId,
    status: 'completed',
    url: input.videoUrl,
    playUrl: input.videoUrl,
    s3Key: input.videoKey,
    bucket: input.bucket,
    title: input.title,
    inputParams,
    isDeleted: false,
    urlExpiresAt: null,
    updatedAt: now,
    update_time: now,
  }
  if (input.posterUrl && input.posterKey) {
    set.thumbnailUrl = input.posterUrl
    set.key = input.posterKey
  }
  if (input.duration != null && Number.isFinite(Number(input.duration)) && Number(input.duration) > 0) {
    set.duration = Number(input.duration)
  }
  return {
    filter: { taskId: input.taskId },
    update: {
      $set: set,
      $setOnInsert: {
        createdAt: now,
        create_time: now,
      },
    },
  }
}

/** Library delete clears the shot video only. Script, stills, and the row stay. */
export function shotUnlinkPatch(): { videoUrl: null; composedVideoUrl: null } {
  return { videoUrl: null, composedVideoUrl: null }
}

/** Library delete clears the merged cut only. Individual shots stay. */
export function mergeUnlinkPatch(): { mergedUrl: null; episodeVideoUrl: null } {
  return { mergedUrl: null, episodeVideoUrl: null }
}

export type MergePickRow = {
  status?: string | null
  mergedUrl?: string | null
  deletedAt?: string | null
  createdAt?: string | null
}

export function pickLatestCompletedMerge<T extends MergePickRow>(rows: T[]): T | undefined {
  return rows
    .filter((row) => !row.deletedAt && row.status === 'completed' && String(row.mergedUrl || '').trim())
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0]
}

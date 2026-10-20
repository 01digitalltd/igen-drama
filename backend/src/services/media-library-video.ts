/**
 * Copy a finished /ai-video file into the media-library video prefix and
 * upsert the shared `volcenginemedias` catalog. Failures are logged by the
 * safe wrappers so shot generation and merge still succeed.
 */
import fs from 'fs'
import { getMongoDb } from '../db/mongo.js'
import { db, schema } from '../db/index.js'
import { eq } from '../db/query.js'
import { now } from '../utils/response.js'
import { OwnershipError } from '../utils/ownership.js'
import { getAbsolutePath, isRemoteStored } from '../utils/storage.js'
import {
  copyObject,
  deleteObject,
  isS3Enabled,
  parseMediaUrlToKey,
  s3Bucket,
} from '../utils/s3-media.js'
import { posterPathFor } from '../utils/video-poster.js'
import type { DramaRow, EpisodeRow, StoryboardRow, VideoMergeRow } from '../db/schema.js'
import {
  MEDIA_LIBRARY_COLLECTION,
  libraryMediaUpsert,
  libraryObjectKeys,
  mergeLibraryTitle,
  mergeTaskId,
  mergeUnlinkPatch,
  ownerObjectId,
  parseLibraryTaskId,
  pickLatestCompletedMerge,
  shotLibraryTitle,
  shotTaskId,
  shotUnlinkPatch,
  siblingPosterKey,
  type LibraryUpsertInput,
} from './media-library-video-plan.js'

type PublishResult = 'published' | 'skipped'

function rowsOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

async function selectWhere<T>(table: { __name: string }, condition: unknown): Promise<T[]> {
  return rowsOf<T>(await db.select().from(table).where(condition))
}

async function selectAll<T>(table: { __name: string }): Promise<T[]> {
  return rowsOf<T>(await db.select().from(table))
}

async function updateWhere(table: unknown, patch: Record<string, unknown>, condition: unknown): Promise<void> {
  await db.update(table as never).set(patch).where(condition)
}

function warnPublish(scope: string, detail: Record<string, unknown>, err?: unknown) {
  const message = err instanceof Error ? err.message : err ? String(err) : ''
  console.warn(`[media-library] ${scope}`, { ...detail, ...(message ? { error: message } : {}) })
}

async function copyStoredToKey(stored: string, destKey: string): Promise<string> {
  const sourceKey = parseMediaUrlToKey(stored)
  if (!sourceKey) throw new Error('stored media has no S3 key')
  if (!isS3Enabled()) throw new Error('S3 is not configured')
  return copyObject(sourceKey, destKey)
}

async function deleteKeyQuiet(key: string | null | undefined): Promise<void> {
  const clean = String(key || '').trim()
  if (!clean || !isS3Enabled()) return
  try {
    await deleteObject(clean)
  } catch (err) {
    warnPublish('delete object failed', { key: clean }, err)
  }
}

async function removeStoredFile(stored: string | null | undefined): Promise<void> {
  const raw = String(stored || '').trim()
  if (!raw) return
  const key = parseMediaUrlToKey(raw)
  if (key) {
    await deleteKeyQuiet(key)
    return
  }
  if (isRemoteStored(raw)) return
  try {
    fs.unlinkSync(getAbsolutePath(raw))
  } catch {
    /* already gone */
  }
}

async function upsertLibraryDoc(input: LibraryUpsertInput): Promise<void> {
  const write = libraryMediaUpsert(input)
  if (!write) throw new Error('owner is not a user id')
  await getMongoDb()
    .collection(MEDIA_LIBRARY_COLLECTION)
    .updateOne(write.filter, write.update, { upsert: true })
}

async function loadShotContext(storyboardId: number) {
  const [sb] = await selectWhere<StoryboardRow>(schema.storyboards, eq(schema.storyboards.id, storyboardId))
  if (!sb || sb.deletedAt) return null
  const [ep] = await selectWhere<EpisodeRow>(schema.episodes, eq(schema.episodes.id, sb.episodeId))
  if (!ep || ep.deletedAt) return null
  const [drama] = await selectWhere<DramaRow>(schema.dramas, eq(schema.dramas.id, ep.dramaId))
  if (!drama || drama.deletedAt) return null
  return { sb, ep, drama }
}

async function publishStoredVideo(input: Omit<LibraryUpsertInput, 'videoUrl' | 'videoKey' | 'posterUrl' | 'posterKey' | 'bucket'> & {
  storedVideo: string
  storedPoster?: string | null
}): Promise<PublishResult> {
  if (!ownerObjectId(input.ownerUserId)) {
    warnPublish('skip missing owner', { taskId: input.taskId })
    return 'skipped'
  }
  if (!parseMediaUrlToKey(input.storedVideo)) {
    warnPublish('skip non-s3 video', { taskId: input.taskId })
    return 'skipped'
  }
  const keys = libraryObjectKeys(input.taskId)
  const videoUrl = await copyStoredToKey(input.storedVideo, keys.videoKey)
  let posterUrl: string | null = null
  const posterStored = String(input.storedPoster || '').trim()
  if (posterStored && parseMediaUrlToKey(posterStored)) {
    try {
      posterUrl = await copyStoredToKey(posterStored, keys.posterKey)
    } catch (err) {
      warnPublish('poster copy failed', { taskId: input.taskId }, err)
    }
  }
  await upsertLibraryDoc({
    ...input,
    videoUrl,
    videoKey: keys.videoKey,
    posterUrl,
    posterKey: posterUrl ? keys.posterKey : null,
    bucket: s3Bucket(),
  })
  return 'published'
}

export async function publishShotToMediaLibrary(
  storyboardId: number,
  storedVideo: string,
  storedPoster?: string | null,
  duration?: number | null,
): Promise<void> {
  try {
    const ctx = await loadShotContext(storyboardId)
    if (!ctx) {
      warnPublish('skip missing shot', { storyboardId })
      return
    }
    await publishStoredVideo({
      taskId: shotTaskId(storyboardId),
      ownerUserId: ctx.drama.ownerUserId || '',
      storedVideo,
      storedPoster,
      title: shotLibraryTitle(ctx.sb.storyboardNumber, ctx.sb.title),
      duration: duration ?? ctx.sb.duration,
      kind: 'shot',
      dramaId: ctx.drama.id,
      episodeId: ctx.ep.id,
      storyboardId,
    })
  } catch (err) {
    warnPublish('shot publish failed', { storyboardId }, err)
  }
}

export async function publishMergeToMediaLibrary(
  episodeId: number,
  storedVideo: string,
  storedPoster?: string | null,
  duration?: number | null,
): Promise<void> {
  try {
    const [ep] = await selectWhere<EpisodeRow>(schema.episodes, eq(schema.episodes.id, episodeId))
    if (!ep || ep.deletedAt) {
      warnPublish('skip missing episode', { episodeId })
      return
    }
    const [drama] = await selectWhere<DramaRow>(schema.dramas, eq(schema.dramas.id, ep.dramaId))
    if (!drama || drama.deletedAt) {
      warnPublish('skip missing episode', { episodeId, dramaId: ep.dramaId })
      return
    }
    await publishStoredVideo({
      taskId: mergeTaskId(episodeId),
      ownerUserId: drama.ownerUserId || '',
      storedVideo,
      storedPoster,
      title: mergeLibraryTitle(ep.title || drama.title),
      duration,
      kind: 'merge',
      dramaId: drama.id,
      episodeId,
    })
  } catch (err) {
    warnPublish('merge publish failed', { episodeId }, err)
  }
}

function assertOwner(
  drama: { ownerUserId: string | null },
  ownerUserId: string | null,
  scopeToOwner: boolean,
) {
  if (!scopeToOwner) return
  if (!ownerUserId || !drama.ownerUserId || drama.ownerUserId !== ownerUserId) {
    throw new OwnershipError('剧本不存在', 404)
  }
}

export async function unlinkMediaLibraryVideo(
  taskId: string,
  ownerUserId: string | null,
  scopeToOwner: boolean,
): Promise<'shot' | 'merge'> {
  const ref = parseLibraryTaskId(taskId)
  if (!ref) {
    const err = new Error('invalid task')
    ;(err as { status?: number }).status = 400
    throw err
  }
  if (ref.kind === 'shot') {
    const ctx = await loadShotContext(ref.storyboardId)
    if (!ctx) throw new OwnershipError('分镜不存在', 404)
    assertOwner(ctx.drama, ownerUserId, scopeToOwner)
    const patch = shotUnlinkPatch()
    await removeStoredFile(ctx.sb.videoUrl)
    await removeStoredFile(ctx.sb.composedVideoUrl)
    const sourceKey = parseMediaUrlToKey(String(ctx.sb.videoUrl || ''))
    if (sourceKey) await deleteKeyQuiet(siblingPosterKey(sourceKey))
    else await removeStoredFile(ctx.sb.videoUrl ? posterPathFor(ctx.sb.videoUrl) : null)
    const copies = libraryObjectKeys(ref.taskId)
    await deleteKeyQuiet(copies.videoKey)
    await deleteKeyQuiet(copies.posterKey)
    await updateWhere(schema.storyboards, { ...patch, updatedAt: now() }, eq(schema.storyboards.id, ref.storyboardId))
    return 'shot'
  }

  const [ep] = await selectWhere<EpisodeRow>(schema.episodes, eq(schema.episodes.id, ref.episodeId))
  if (!ep || ep.deletedAt) throw new OwnershipError('剧集不存在', 404)
  const [drama] = await selectWhere<DramaRow>(schema.dramas, eq(schema.dramas.id, ep.dramaId))
  if (!drama || drama.deletedAt) throw new OwnershipError('剧本不存在', 404)
  assertOwner(drama, ownerUserId, scopeToOwner)
  const merges = await selectWhere<VideoMergeRow>(schema.videoMerges, eq(schema.videoMerges.episodeId, ref.episodeId))
  const latest = pickLatestCompletedMerge(merges)
  const patch = mergeUnlinkPatch()
  if (latest?.mergedUrl) {
    await removeStoredFile(latest.mergedUrl)
    const sourceKey = parseMediaUrlToKey(latest.mergedUrl)
    if (sourceKey) await deleteKeyQuiet(siblingPosterKey(sourceKey))
    else await removeStoredFile(posterPathFor(latest.mergedUrl))
    await updateWhere(schema.videoMerges, { mergedUrl: patch.mergedUrl }, eq(schema.videoMerges.id, latest.id))
  }
  if (ep.videoUrl && ep.videoUrl !== latest?.mergedUrl) {
    await removeStoredFile(ep.videoUrl)
  }
  const copies = libraryObjectKeys(ref.taskId)
  await deleteKeyQuiet(copies.videoKey)
  await deleteKeyQuiet(copies.posterKey)
  await updateWhere(
    schema.episodes,
    { videoUrl: patch.episodeVideoUrl, updatedAt: now() },
    eq(schema.episodes.id, ref.episodeId),
  )
  return 'merge'
}

export async function backfillMediaLibraryVideos(): Promise<{
  shots: number
  merges: number
  skipped: number
  failed: number
}> {
  const stats = { shots: 0, merges: 0, skipped: 0, failed: 0 }
  const dramas = await selectAll<DramaRow>(schema.dramas)
  for (const drama of dramas) {
    if (drama.deletedAt || !ownerObjectId(drama.ownerUserId)) {
      stats.skipped += 1
      continue
    }
    const episodes = await selectWhere<EpisodeRow>(schema.episodes, eq(schema.episodes.dramaId, drama.id))
    for (const ep of episodes) {
      if (ep.deletedAt) continue
      const shots = await selectWhere<StoryboardRow>(schema.storyboards, eq(schema.storyboards.episodeId, ep.id))
      for (const sb of shots) {
        if (sb.deletedAt || !String(sb.videoUrl || '').trim()) continue
        const before = stats.failed
        try {
          const poster = posterPathFor(String(sb.videoUrl))
          const result = await publishStoredVideo({
            taskId: shotTaskId(sb.id),
            ownerUserId: drama.ownerUserId || '',
            storedVideo: String(sb.videoUrl),
            storedPoster: poster,
            title: shotLibraryTitle(sb.storyboardNumber, sb.title),
            duration: sb.duration,
            kind: 'shot',
            dramaId: drama.id,
            episodeId: ep.id,
            storyboardId: sb.id,
          })
          if (result === 'published') stats.shots += 1
          else stats.skipped += 1
        } catch (err) {
          if (stats.failed === before) stats.failed += 1
          warnPublish('backfill shot failed', { storyboardId: sb.id }, err)
        }
      }
      const merges = await selectWhere<VideoMergeRow>(schema.videoMerges, eq(schema.videoMerges.episodeId, ep.id))
      const latest = pickLatestCompletedMerge(merges)
      if (!latest?.mergedUrl) continue
      try {
        const result = await publishStoredVideo({
          taskId: mergeTaskId(ep.id),
          ownerUserId: drama.ownerUserId || '',
          storedVideo: latest.mergedUrl,
          storedPoster: posterPathFor(latest.mergedUrl),
          title: mergeLibraryTitle(ep.title || drama.title),
          duration: latest.duration,
          kind: 'merge',
          dramaId: drama.id,
          episodeId: ep.id,
        })
        if (result === 'published') stats.merges += 1
        else stats.skipped += 1
      } catch (err) {
        stats.failed += 1
        warnPublish('backfill merge failed', { episodeId: ep.id }, err)
      }
    }
  }
  return stats
}

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMediaUrlToKey } from '../src/utils/s3-media.ts'
import {
  libraryMediaUpsert,
  libraryObjectKeys,
  mergeTaskId,
  mergeUnlinkPatch,
  ownerObjectId,
  parseLibraryTaskId,
  pickLatestCompletedMerge,
  shotTaskId,
  shotUnlinkPatch,
} from '../src/services/media-library-video-plan.ts'

const OWNER = '507f1f77bcf86cd799439011'

test('shot and merge task ids stay stable across reruns', () => {
  assert.equal(shotTaskId(12), 'drama-sb-12')
  assert.equal(mergeTaskId(4), 'drama-ep-4-merge')
  assert.deepEqual(parseLibraryTaskId(shotTaskId(12)), {
    kind: 'shot',
    storyboardId: 12,
    taskId: 'drama-sb-12',
  })
  assert.deepEqual(parseLibraryTaskId(mergeTaskId(4)), {
    kind: 'merge',
    episodeId: 4,
    taskId: 'drama-ep-4-merge',
  })
  assert.equal(parseLibraryTaskId('temp_user_1'), null)
  assert.equal(libraryObjectKeys('drama-sb-12').videoKey, 'videos/drama-sb-12/video.mp4')
})

test('rerun updates the same card and does not reset createdAt', () => {
  const now = new Date('2026-10-20T00:00:00.000Z')
  const first = libraryMediaUpsert({
    taskId: shotTaskId(3),
    ownerUserId: OWNER,
    videoUrl: 'https://cdn.example/videos/drama-sb-3/video.mp4',
    videoKey: 'videos/drama-sb-3/video.mp4',
    bucket: 'bucket',
    title: '分鏡 3',
    kind: 'shot',
    dramaId: 1,
    episodeId: 2,
    storyboardId: 3,
    now,
  })
  const second = libraryMediaUpsert({
    taskId: shotTaskId(3),
    ownerUserId: OWNER,
    videoUrl: 'https://cdn.example/videos/drama-sb-3/video.mp4',
    videoKey: 'videos/drama-sb-3/video.mp4',
    posterUrl: 'https://cdn.example/videos/drama-sb-3/poster.jpg',
    posterKey: 'videos/drama-sb-3/poster.jpg',
    bucket: 'bucket',
    title: '分鏡 3',
    kind: 'shot',
    dramaId: 1,
    episodeId: 2,
    storyboardId: 3,
    now,
  })
  assert.ok(first)
  assert.ok(second)
  assert.deepEqual(first.filter, second.filter)
  assert.equal(first.filter.taskId, 'drama-sb-3')
  assert.equal('createdAt' in first.update.$set, false)
  assert.ok(first.update.$setOnInsert.createdAt)
  assert.equal(second.update.$set.key, 'videos/drama-sb-3/poster.jpg')
  assert.equal((second.update.$set.inputParams as { source: string }).source, 'ai-video')
})

test('skips a missing or invalid owner and a non-s3 path', () => {
  assert.equal(ownerObjectId(null), null)
  assert.equal(ownerObjectId('not-an-id'), null)
  assert.ok(ownerObjectId(OWNER))
  assert.equal(
    libraryMediaUpsert({
      taskId: shotTaskId(1),
      ownerUserId: '',
      videoUrl: 'https://cdn.example/v.mp4',
      videoKey: 'videos/drama-sb-1/video.mp4',
      bucket: 'bucket',
      title: '分鏡 1',
      kind: 'shot',
      dramaId: 1,
      episodeId: 1,
      storyboardId: 1,
    }),
    null,
  )
  assert.equal(parseMediaUrlToKey('static/videos/a.mp4'), null)
  assert.equal(parseMediaUrlToKey('drama/videos/a.mp4'), 'drama/videos/a.mp4')
})

test('unlink clears the video file and leaves the shot row fields alone', () => {
  assert.deepEqual(shotUnlinkPatch(), { videoUrl: null, composedVideoUrl: null })
  assert.equal('title' in shotUnlinkPatch(), false)
  assert.deepEqual(mergeUnlinkPatch(), { mergedUrl: null, episodeVideoUrl: null })
  assert.equal('storyboardId' in mergeUnlinkPatch(), false)
})

test('backfill picks the newest completed merge only', () => {
  const picked = pickLatestCompletedMerge([
    { status: 'completed', mergedUrl: 'drama/merged/old.mp4', createdAt: '2026-01-01T00:00:00.000Z' },
    { status: 'failed', mergedUrl: 'drama/merged/bad.mp4', createdAt: '2026-06-01T00:00:00.000Z' },
    { status: 'completed', mergedUrl: 'drama/merged/new.mp4', createdAt: '2026-03-01T00:00:00.000Z' },
    { status: 'completed', mergedUrl: 'drama/merged/gone.mp4', createdAt: '2026-08-01T00:00:00.000Z', deletedAt: '2026-08-02T00:00:00.000Z' },
  ])
  assert.equal(picked?.mergedUrl, 'drama/merged/new.mp4')
})

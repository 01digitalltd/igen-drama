import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MINIMAX_VIDEO_CONCURRENT_DEFAULT,
  splitVideoQueueByConcurrency,
  videoMaxConcurrentForProvider,
} from '../src/services/video-queue.ts'

test('MiniMax can run several clips; Gemini stays serial', () => {
  assert.equal(videoMaxConcurrentForProvider('minimax'), MINIMAX_VIDEO_CONCURRENT_DEFAULT)
  assert.equal(videoMaxConcurrentForProvider('minimax', { DRAMA_VIDEO_CONCURRENT_MINIMAX: '8' }), 8)
  assert.equal(videoMaxConcurrentForProvider('minimax', { DRAMA_VIDEO_CONCURRENT_MINIMAX: '99' }), 15)
  assert.equal(videoMaxConcurrentForProvider('gemini'), 1)
  assert.equal(videoMaxConcurrentForProvider('volcengine'), 1)
})

test('splitVideoQueueByConcurrency starts MiniMax in parallel and defers the rest', () => {
  const queued = [1, 2, 3, 4, 5, 6].map((id) => ({ id, provider: 'minimax' }))
  const { start, defer } = splitVideoQueueByConcurrency(queued, {})
  assert.deepEqual(start.map((item) => item.id), [1, 2, 3, 4, 5])
  assert.deepEqual(defer.map((item) => item.id), [6])
})

test('splitVideoQueueByConcurrency keeps Gemini serial while MiniMax still fills', () => {
  const queued = [
    { id: 1, provider: 'minimax' },
    { id: 2, provider: 'gemini' },
    { id: 3, provider: 'gemini' },
    { id: 4, provider: 'minimax' },
  ]
  const { start, defer } = splitVideoQueueByConcurrency(queued, { minimax: 4, gemini: 0 })
  assert.deepEqual(start.map((item) => item.id), [1, 2])
  assert.deepEqual(defer.map((item) => item.id), [3, 4])
})

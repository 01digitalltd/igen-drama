import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isActiveGenerationStatus,
  pickLatestActiveTask,
} from '../src/utils/generation-task-status.ts'

test('queued/pending/processing occupy a storyboard; terminal statuses do not', () => {
  assert.equal(isActiveGenerationStatus('queued'), true)
  assert.equal(isActiveGenerationStatus('processing'), true)
  assert.equal(isActiveGenerationStatus('pending'), true)
  assert.equal(isActiveGenerationStatus('PROCESSING'), true)
  assert.equal(isActiveGenerationStatus('completed'), false)
  assert.equal(isActiveGenerationStatus('failed'), false)
  assert.equal(isActiveGenerationStatus('cancelled'), false)
  assert.equal(isActiveGenerationStatus(''), false)
})

test('pickLatestActiveTask returns the newest in-progress video and ignores finished ones', () => {
  const picked = pickLatestActiveTask([
    { id: 100, status: 'processing', createdAt: '2026-09-07T16:33:45Z' },
    { id: 101, status: 'queued', createdAt: '2026-09-07T16:34:09Z' },
    { id: 90, status: 'completed', createdAt: '2026-09-07T16:40:00Z' },
  ])
  assert.equal(picked?.id, 101)
})

test('pickLatestActiveTask is undefined when nothing is in progress — regenerate is allowed', () => {
  assert.equal(
    pickLatestActiveTask([
      { id: 100, status: 'completed', createdAt: '2026-09-07T16:33:45Z' },
      { id: 99, status: 'failed', createdAt: '2026-09-07T16:20:00Z' },
    ]),
    undefined,
  )
})

test('same createdAt falls back to higher id', () => {
  const picked = pickLatestActiveTask([
    { id: 8, status: 'processing', createdAt: '2026-09-07T16:33:45Z' },
    { id: 9, status: 'queued', createdAt: '2026-09-07T16:33:45Z' },
  ])
  assert.equal(picked?.id, 9)
})

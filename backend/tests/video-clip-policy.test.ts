import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertClipSecondsFit,
  clampDialogueFloor,
  clampShotDurationForModel,
  clipDurationBounds,
  dialogueFloorSeconds,
  durationExceedsMax,
  estimatedShotCount,
  firstConfigModel,
} from '../src/services/video-clip-policy.ts'

test('clipDurationBounds matches vendor clip limits', () => {
  assert.deepEqual(clipDurationBounds('gemini', 'gemini-omni-flash-preview'), {
    min: 3, max: 10, typical: 8, promptSegment: 3,
  })
  assert.equal(clipDurationBounds('minimax', 'MiniMax-H3').max, 15)
  assert.equal(clipDurationBounds('volcengine', 'dreamina-seedance-2-0-260128').typical, 12)
})

test('clamps storyboard duration to the locked model', () => {
  const omni = clipDurationBounds('gemini', 'omni')
  assert.equal(clampShotDurationForModel(15, omni, 8), 10)
  assert.equal(clampShotDurationForModel(2, omni, 8), 3)
  assert.equal(clampShotDurationForModel(null, omni, 8), 8)
})

test('dialogue floor cannot exceed the model max', () => {
  assert.equal(dialogueFloorSeconds(45), 12)
  assert.equal(clampDialogueFloor(45, clipDurationBounds('gemini', 'omni')), 10)
})

test('estimated shot count follows typical clip length ±20%', () => {
  assert.deepEqual(estimatedShotCount(80, 10), { typical: 8, min: 6, max: 10 })
})

test('firstConfigModel reads JSON arrays and raw ids', () => {
  assert.equal(firstConfigModel('["gemini-omni-flash-preview"]'), 'gemini-omni-flash-preview')
  assert.equal(firstConfigModel('MiniMax-H3'), 'MiniMax-H3')
})

test('assertClipSecondsFit blocks prompt/shot overflow', () => {
  const omni = clipDurationBounds('gemini', 'omni')
  assert.doesNotThrow(() => assertClipSecondsFit(10, omni, 'prompt'))
  assert.throws(() => assertClipSecondsFit(15, omni, 'prompt'), /15s/)
  assert.ok(durationExceedsMax(15, 10))
  assert.equal(durationExceedsMax(10, 10), false)
})

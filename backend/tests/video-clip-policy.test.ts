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
  episodeDurationBudget,
  acceptShotsWithinCount,
  fitShotDurationsToBudget,
  expandGeminiOmniVideoModels,
  firstConfigModel,
  promptSkillForVideo,
  toAgentVideoGeneration,
} from '../src/services/video-clip-policy.ts'

test('clipDurationBounds matches vendor clip limits', () => {
  assert.deepEqual(clipDurationBounds('gemini', 'gemini-omni-flash-preview'), {
    min: 3, max: 10, typical: 8, promptSegment: 3,
  })
  assert.equal(clipDurationBounds('minimax', 'MiniMax-H3').max, 15)
  assert.equal(clipDurationBounds('minimax', 'MiniMax-H3').min, 4)
  assert.equal(clipDurationBounds('minimax', 'MiniMax-H3-Max').min, 5)
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

test('episode duration budget caps MiniMax 30s to a few shots that can still fit', () => {
  const bounds = clipDurationBounds('minimax', 'MiniMax-H3')
  const budget = episodeDurationBudget(30, bounds)
  assert.equal(budget.target_seconds, 30)
  assert.equal(budget.max_total_seconds, 30)
  assert.deepEqual(budget.estimated_shot_count, { typical: 3, min: 2, max: 4 })
  assert.equal(budget.suggested_shot_duration, 10)
  assert.ok(budget.estimated_shot_count.max * bounds.min <= 30)
})

test('fitShotDurationsToBudget scales 3x12s MiniMax shots down to 30s', () => {
  const bounds = clipDurationBounds('minimax', 'MiniMax-H3')
  assert.deepEqual(fitShotDurationsToBudget([12, 12, 12], 30, bounds), [10, 10, 10])
})

test('acceptShotsWithinCount keeps updates and rejects extra shot numbers', () => {
  const incoming = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ shot_number: n }))
  const first = acceptShotsWithinCount([], incoming, 3)
  assert.deepEqual(first.accepted.map((s) => s.shot_number), [1, 2, 3])
  assert.deepEqual(first.rejected.map((s) => s.shot_number), [4, 5, 6, 7, 8])
  const extra = acceptShotsWithinCount([1, 2, 3], [{ shot_number: 4 }], 3)
  assert.equal(extra.accepted.length, 0)
  assert.deepEqual(extra.rejected.map((s) => s.shot_number), [4])
  const upsert = acceptShotsWithinCount([1, 2], [{ shot_number: 2 }, { shot_number: 3 }, { shot_number: 4 }], 3)
  assert.deepEqual(upsert.accepted.map((s) => s.shot_number), [2, 3])
  assert.deepEqual(upsert.rejected.map((s) => s.shot_number), [4])
})

test('firstConfigModel reads JSON arrays and raw ids', () => {
  assert.equal(firstConfigModel('["gemini-omni-flash-preview"]'), 'gemini-omni-flash-preview')
  assert.equal(firstConfigModel('MiniMax-H3'), 'MiniMax-H3')
})

test('Gemini video configs also offer Omni 1.1 even if DB only lists preview', () => {
  assert.deepEqual(
    expandGeminiOmniVideoModels('gemini', ['gemini-omni-flash-preview']),
    ['gemini-omni-1.1-flash', 'gemini-omni-flash-preview'],
  )
  assert.deepEqual(expandGeminiOmniVideoModels('minimax', ['MiniMax-H3']), ['MiniMax-H3'])
})

test('assertClipSecondsFit blocks prompt/shot overflow', () => {
  const omni = clipDurationBounds('gemini', 'omni')
  assert.doesNotThrow(() => assertClipSecondsFit(10, omni, 'prompt'))
  assert.throws(() => assertClipSecondsFit(15, omni, 'prompt'), /15s/)
  assert.ok(durationExceedsMax(15, 10))
  assert.equal(durationExceedsMax(10, 10), false)
})

test('prompt_skill routes Gemini Omni away from Seedance format', () => {
  assert.equal(promptSkillForVideo('gemini', 'gemini-omni-flash-preview'), 'omni')
  assert.equal(promptSkillForVideo('gemini', 'gemini-omni-1.1-flash'), 'omni')
  assert.equal(promptSkillForVideo('volcengine', 'doubao-seedance-2-0-fast-260128'), 'seedance')
  assert.equal(promptSkillForVideo('minimax', 'MiniMax-H3'), 'seedance')
  assert.equal(
    toAgentVideoGeneration({
      provider: 'gemini',
      model: 'gemini-omni-flash-preview',
      bounds: clipDurationBounds('gemini', 'omni'),
    }).prompt_skill,
    'omni',
  )
  assert.equal(
    toAgentVideoGeneration({
      provider: 'minimax',
      model: 'MiniMax-H3',
      bounds: clipDurationBounds('minimax', 'MiniMax-H3'),
      targetDurationSeconds: 30,
    }).max_total_seconds,
    30,
  )
  assert.equal(
    toAgentVideoGeneration({
      provider: 'minimax',
      model: 'MiniMax-H3',
      bounds: clipDurationBounds('minimax', 'MiniMax-H3'),
      targetDurationSeconds: 30,
    }).suggested_shot_duration,
    10,
  )
})

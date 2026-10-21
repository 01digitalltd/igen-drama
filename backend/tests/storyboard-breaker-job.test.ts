import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  STORYBOARD_SAVE_FOLLOW_UP,
  shouldRetryStoryboardBreaker,
  storyboardBreakerFailure,
  storyboardBreakerPrepareStep,
  storyboardGenerateDiagnostic,
  durationStopFromToolResult,
} from '../src/services/storyboard-breaker-job.ts'

test('storyboard breaker reports a rejected save even when old shots remain', () => {
  assert.equal(
    storyboardBreakerFailure({
      liveShotCount: 3,
      toolResults: [{ toolName: 'save_storyboards', result: JSON.stringify({ error: 'over budget' }) }],
    }),
    'over budget',
  )
})

test('storyboard breaker recognizes the Gemini tool name saveStoryboards', () => {
  assert.equal(
    storyboardBreakerFailure({
      liveShotCount: 4,
      toolResults: [{ toolName: 'saveStoryboards', result: JSON.stringify({ count: 4 }) }],
    }),
    null,
  )
})

test('storyboard breaker stays successful after a save that wrote shots', () => {
  assert.equal(
    storyboardBreakerFailure({
      liveShotCount: 3,
      toolResults: [{ toolName: 'save_storyboards', result: JSON.stringify({ count: 3 }) }],
    }),
    null,
  )
})

test('storyboard breaker surfaces save_storyboards tool error when nothing was written', () => {
  const message = storyboardBreakerFailure({
    liveShotCount: 0,
    toolResults: [{
      toolName: 'save_storyboards',
      result: JSON.stringify({ error: '本集目标 30 秒，最多 4 个分镜。' }),
    }],
  })
  assert.match(String(message), /最多 4 个分镜/)
})

test('storyboard breaker fails when old shots remain and nothing was saved', () => {
  assert.equal(
    storyboardBreakerFailure({ liveShotCount: 6, toolResults: [] }),
    '拆分鏡沒有改寫鏡頭，請再試一次。',
  )
})

test('storyboard breaker fails when the agent finished without writing shots', () => {
  assert.equal(
    storyboardBreakerFailure({ liveShotCount: 0, toolResults: [] }),
    '拆分鏡沒有寫入任何鏡頭，請再試一次。',
  )
})

test('agent jobs mark storyboard_breaker error when no live shots were saved', () => {
  const jobs = readFileSync(new URL('../src/services/agent-jobs.ts', import.meta.url), 'utf8')
  assert.match(jobs, /storyboardBreakerFailure/)
  assert.match(jobs, /countLiveStoryboards/)
  assert.match(jobs, /storyboard_breaker-retry/)
  assert.match(jobs, /STORYBOARD_SAVE_FOLLOW_UP/)
  assert.match(jobs, /storyboardBreakerPrepareStep/)
  assert.match(jobs, /storyboardDurationOverage/)
  assert.match(jobs, /duration_over/)
})

test('a stop tool result carries the seconds the dialog needs', () => {
  assert.deepEqual(durationStopFromToolResult(JSON.stringify({
    error: '停止拆分镜：这些镜头至少要 33 秒，本集目标只有 30 秒。',
    needed_seconds: 33,
    max_total_seconds: 30,
  })), { needed: 33, target: 30 })
  assert.equal(durationStopFromToolResult(JSON.stringify({ error: '镜头装不下' })), null)
})

test('storyboard save follow-up requires save_storyboards before ending', () => {
  assert.match(STORYBOARD_SAVE_FOLLOW_UP, /save_storyboards/)
  assert.match(STORYBOARD_SAVE_FOLLOW_UP, /replace_existing/)
})

test('storyboard breaker forces a read, then a save, then stops forcing after a save', () => {
  assert.deepEqual(storyboardBreakerPrepareStep({ stepNumber: 0, steps: [] }), {
    toolChoice: { type: 'tool', toolName: 'readStoryboardContext' },
  })
  assert.deepEqual(storyboardBreakerPrepareStep({ stepNumber: 1, steps: [] }), {
    toolChoice: { type: 'tool', toolName: 'saveStoryboards' },
  })
  assert.deepEqual(storyboardBreakerPrepareStep({
    stepNumber: 2,
    steps: [{ toolCalls: [{ toolName: 'saveStoryboards' }] }],
  }), { toolChoice: 'auto' })
  assert.deepEqual(storyboardBreakerPrepareStep({
    stepNumber: 2,
    steps: [{ toolResults: [{ result: '{"error":"停止拆分镜：这些镜头至少要 33 秒"}' }] }],
  }), { toolChoice: 'none' })
})

test('a stop error does not start another storyboard generate', () => {
  assert.equal(shouldRetryStoryboardBreaker(null), false)
  assert.equal(shouldRetryStoryboardBreaker('镜头装不下'), false)
  assert.equal(shouldRetryStoryboardBreaker('拆分鏡沒有寫入任何鏡頭，請再試一次。'), true)
  assert.equal(shouldRetryStoryboardBreaker('停止拆分镜：这些镜头至少要 33 秒'), false)
})

test('three rejected saves stop the storyboard breaker', () => {
  const rejected = {
    toolResults: [{ toolName: 'saveStoryboards', result: '{"error":"镜头装不下"}' }],
  }
  assert.deepEqual(storyboardBreakerPrepareStep({
    stepNumber: 4,
    steps: [rejected, rejected, rejected],
  }), { toolChoice: 'none' })
})

test('storyboard generate diagnostic keeps the finish reason', () => {
  assert.match(storyboardGenerateDiagnostic({
    finishReason: 'stop',
    warnings: [{ message: 'empty content' }],
    steps: [{}],
  }), /finish=stop/)
  assert.match(storyboardGenerateDiagnostic({
    finishReason: 'stop',
    warnings: [{ message: 'empty content' }],
  }), /empty content/)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { storyboardBreakerFailure } from '../src/services/storyboard-breaker-job.ts'

test('storyboard breaker stays successful when live shots exist', () => {
  assert.equal(
    storyboardBreakerFailure({
      liveShotCount: 3,
      toolResults: [{ toolName: 'save_storyboards', result: JSON.stringify({ error: 'over budget' }) }],
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
})

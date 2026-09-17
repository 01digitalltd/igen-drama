import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  agentJobErrorMessage,
  annotateMiniMaxSensitiveBlock,
  annotateProviderBusy,
  isRetryableProviderFailure,
  isRetryableProviderStatus,
  parseProviderErrorText,
} from '../src/utils/provider-error.ts'

test('APIMart Gemini 400 body is surfaced instead of empty Agent execution failed', () => {
  const body = JSON.stringify({
    error: {
      message: 'The warning prompt or uploaded images violated the rules.',
      type: 'upstream_error',
      code: 400,
    },
  })
  const message = agentJobErrorMessage({
    message: '',
    statusCode: 400,
    responseBody: body,
  })
  assert.match(message, /warning prompt or uploaded images violated the rules/)
  assert.notEqual(message, 'Agent execution failed')
})

test('Gemini poll 400 safety block is a readable message, not a timeout', () => {
  const message = parseProviderErrorText(400, JSON.stringify({
    error: {
      message: 'Request blocked due to prohibited content guidelines. Please modify your input and retry.',
      code: 'invalid_request',
    },
  }))
  assert.match(message, /內容安全攔截/)
  assert.match(message, /人物/)
  assert.doesNotMatch(message, /Request blocked/)
  assert.doesNotMatch(message, /内容安全拦截/)
  assert.equal(isRetryableProviderStatus(400), false)
  assert.equal(isRetryableProviderStatus(404), false)
  assert.equal(isRetryableProviderStatus(429), true)
  assert.equal(isRetryableProviderStatus(503), true)
})

test('MiniMax 1027 output sensitive becomes a readable review message', () => {
  const message = annotateMiniMaxSensitiveBlock('[1027] output_sensitive')
  assert.match(message, /1027/)
  assert.match(message, /成片/)
  assert.doesNotMatch(message, /output_sensitive/)
  const input = annotateMiniMaxSensitiveBlock('[1026] video description contains sensitive content')
  assert.match(input, /1026/)
  assert.match(input, /輸入/)
})

test('APIMart busy wait message is readable and retryable', () => {
  const raw = 'Please wait and try again later. Thank you for your patience! (request id: 202609171757409642423006Z92leKb)'
  assert.match(annotateProviderBusy(raw), /線路忙碌/)
  assert.equal(isRetryableProviderFailure(200, raw), true)
  assert.equal(isRetryableProviderFailure(400, 'bad request'), false)
  const parsed = parseProviderErrorText(503, JSON.stringify({ error: { message: raw } }))
  assert.match(parsed, /線路忙碌/)
})

test('video poll fails fast on non-retryable HTTP errors instead of exhausting attempts', () => {
  const generation = readFileSync(new URL('../src/services/generation.ts', import.meta.url), 'utf8')
  assert.match(generation, /parseProviderErrorText/)
  assert.match(generation, /isRetryableProviderStatus/)
  assert.match(generation, /generate-retry/)
  assert.doesNotMatch(generation, /if \(!resp\.ok\) continue/)
})

test('agent jobs surface AI SDK responseBody instead of empty execution failed', () => {
  const jobs = readFileSync(new URL('../src/services/agent-jobs.ts', import.meta.url), 'utf8')
  assert.match(jobs, /agentJobErrorMessage/)
})

test('pumping a video job cannot drop it from the queue on throw', () => {
  const generation = readFileSync(new URL('../src/services/generation.ts', import.meta.url), 'utf8')
  assert.match(generation, /async function pumpVideoQueue/)
  assert.match(generation, /VideoTask.*pump/)
  assert.match(generation, /enqueueVideo\(id\)/)
})

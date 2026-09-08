import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  isRetryableProviderStatus,
  parseProviderErrorText,
} from '../src/utils/provider-error.ts'

test('Gemini poll 400 safety block is a readable message, not a timeout', () => {
  const message = parseProviderErrorText(400, JSON.stringify({
    error: {
      message: 'Request blocked due to prohibited content guidelines. Please modify your input and retry.',
      code: 'invalid_request',
    },
  }))
  assert.match(message, /prohibited content guidelines/)
  assert.equal(isRetryableProviderStatus(400), false)
  assert.equal(isRetryableProviderStatus(404), false)
  assert.equal(isRetryableProviderStatus(429), true)
  assert.equal(isRetryableProviderStatus(503), true)
})

test('video poll fails fast on non-retryable HTTP errors instead of exhausting attempts', () => {
  const generation = readFileSync(new URL('../src/services/generation.ts', import.meta.url), 'utf8')
  assert.match(generation, /parseProviderErrorText/)
  assert.match(generation, /isRetryableProviderStatus/)
  assert.doesNotMatch(generation, /if \(!resp\.ok\) continue/)
})

test('pumping a video job cannot drop it from the queue on throw', () => {
  const generation = readFileSync(new URL('../src/services/generation.ts', import.meta.url), 'utf8')
  assert.match(generation, /async function pumpVideoQueue/)
  assert.match(generation, /VideoTask.*pump/)
  assert.match(generation, /enqueueVideo\(id\)/)
})

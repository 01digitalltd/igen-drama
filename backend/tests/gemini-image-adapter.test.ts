import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GeminiImageAdapter } from '../src/services/adapters/gemini-image.ts'

const adapter = new GeminiImageAdapter()
const config = {
  provider: 'gemini',
  baseUrl: 'https://generativelanguage.googleapis.com',
  apiKey: 'test-key',
  model: 'gemini-3.1-flash-image',
}

test('official Gemini image generate uses generateContent, not interactions POST', () => {
  const req = adapter.buildGenerateRequest(config, {
    id: 1,
    model: 'gemini-3.1-flash-image',
    prompt: 'a street at night',
    size: '1920x1080',
  })

  assert.equal(req.method, 'POST')
  assert.match(req.url, /\/v1beta\/models\/gemini-3\.1-flash-image:generateContent/)
  assert.doesNotMatch(req.url, /\/interactions/)
  assert.equal(req.body.generationConfig.imageConfig.aspectRatio, '16:9')
  assert.equal(req.body.generationConfig.imageConfig.imageSize, '2K')
  assert.deepEqual(req.body.generationConfig.responseModalities, ['IMAGE', 'TEXT'])
})

test('Gemini generateContent inline image is treated as sync, not a poll job', () => {
  const parsed = adapter.parseGenerateResponse({
    responseId: 'resp_1',
    candidates: [{
      finishReason: 'STOP',
      content: {
        parts: [{ inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' } }],
      },
    }],
  })

  assert.equal(parsed.isAsync, false)
  assert.equal(parsed.taskId, undefined)
})

test('Interactions id alone does not start polling', () => {
  assert.throws(
    () => adapter.parseGenerateResponse({
      id: 'v1_ChdsS09YYXBTRUo3eV8wLWtQeGN5N3lRVRIXbEtPWGFwU0VKN3lfMC1rUHhjeTd5UVU',
      status: 'completed',
    }),
    /No image data/,
  )
})

test('in-progress Interactions response is polled at /v1beta/interactions/{id}', () => {
  const parsed = adapter.parseGenerateResponse({
    id: 'v1_ChdsS09YYXBTRUo3eV8wLWtQeGN5N3lRVRIXbEtPWGFwU0VKN3lfMC1rUHhjeTd5UVU',
    status: 'in_progress',
  })
  assert.equal(parsed.isAsync, true)
  assert.equal(parsed.taskId, 'v1_ChdsS09YYXBTRUo3eV8wLWtQeGN5N3lRVRIXbEtPWGFwU0VKN3lfMC1rUHhjeTd5UVU')

  const poll = adapter.buildPollRequest(config, parsed.taskId!)
  assert.equal(poll.method, 'GET')
  assert.match(poll.url, /\/v1beta\/interactions\/v1_ChdsS09Y/)
  assert.doesNotMatch(poll.url, /\/v1beta\/v1_Chd/)
  assert.equal(poll.headers['Api-Revision'], '2026-05-20')
})

test('poll parser waits until an image exists instead of faking completed', () => {
  assert.equal(adapter.parsePollResponse({ status: 'in_progress' }).status, 'processing')
  assert.equal(
    adapter.parsePollResponse({ status: 'completed' }).status,
    'failed',
  )
  assert.equal(
    adapter.parsePollResponse({
      status: 'completed',
      output_image: { mime_type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' },
    }).status,
    'completed',
  )
})

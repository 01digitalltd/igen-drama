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

test('APIMart Gemini image generate uses Bearer and no query key', () => {
  const req = adapter.buildGenerateRequest({
    ...config,
    baseUrl: 'https://api.apimart.ai',
    apiKey: 'sk-proxy',
  }, {
    id: 1,
    model: 'gemini-3.1-flash-image',
    prompt: 'a street at night',
    size: '1920x1080',
  })

  assert.match(req.url, /https:\/\/api\.apimart\.ai\/v1beta\/models\/gemini-3\.1-flash-image:generateContent/)
  assert.doesNotMatch(req.url, /[?&]key=/)
  assert.equal(req.headers.Authorization, 'Bearer sk-proxy')
  assert.equal(req.headers['x-goog-api-key'], undefined)
})

test('APIMart wrapped generateContent image is treated as sync', () => {
  const parsed = adapter.parseGenerateResponse({
    code: 200,
    data: {
      candidates: [{
        finishReason: 'STOP',
        content: {
          parts: [{ inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' } }],
        },
      }],
    },
  })

  assert.equal(parsed.isAsync, false)
  assert.equal(parsed.taskId, undefined)
})

test('Gemini still generation labels asset images before the prompt', () => {
  const req = adapter.buildGenerateRequest(config, {
    id: 1,
    model: 'gemini-3.1-flash-image',
    prompt: '单帧分镜静帧，小華坐在办公桌前。',
    size: '1920x1080',
    referenceImages: JSON.stringify([
      { url: 'data:image/jpeg;base64,aaa', caption: '第一张图是角色设定（小華）。' },
      { url: 'data:image/png;base64,bbb', caption: '第二张图是场景空镜（辦公室）。' },
    ]),
  })

  assert.equal(req.body.contents[0].role, 'user')
  assert.deepEqual(req.body.contents[0].parts, [
    { text: '第一张图是角色设定（小華）。' },
    { inlineData: { mimeType: 'image/jpeg', data: 'aaa' } },
    { text: '第二张图是场景空镜（辦公室）。' },
    { inlineData: { mimeType: 'image/png', data: 'bbb' } },
    { text: '单帧分镜静帧，小華坐在办公桌前。' },
  ])
})

test('Gemini stills send public HTTP asset URLs as fileData', () => {
  const req = adapter.buildGenerateRequest(config, {
    id: 1,
    model: 'gemini-3.1-flash-image',
    prompt: '单帧分镜静帧',
    size: '1920x1080',
    referenceImages: JSON.stringify([
      { url: 'https://cdn.example.com/char.png', caption: '第一张图是角色设定（小華）。' },
    ]),
  })
  assert.deepEqual(req.body.contents[0].parts, [
    { text: '第一张图是角色设定（小華）。' },
    { fileData: { mimeType: 'image/png', fileUri: 'https://cdn.example.com/char.png' } },
    { text: '单帧分镜静帧' },
  ])
})

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
  assert.match(req.url, /key=test-key/)
  assert.equal(req.headers['x-goog-api-key'], 'test-key')
  assert.equal(req.body.contents[0].role, 'user')
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

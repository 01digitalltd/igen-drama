import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MiniMaxVideoAdapter,
  chooseMiniMaxVideoMode,
  isMiniMaxH3Max,
  normalizeMiniMaxDuration,
  normalizeMiniMaxResolution,
} from '../src/services/adapters/minimax-video.ts'

const adapter = new MiniMaxVideoAdapter()
const config = {
  provider: 'minimax',
  baseUrl: 'https://api.minimax.io',
  apiKey: 'test-key',
  model: 'MiniMax-H3',
}

test('H3 duration/resolution and exclusive video modes', () => {
  assert.equal(isMiniMaxH3Max('MiniMax-H3'), false)
  assert.equal(isMiniMaxH3Max('MiniMax-H3-Max'), true)
  assert.equal(normalizeMiniMaxDuration(3, 'MiniMax-H3'), 4)
  assert.equal(normalizeMiniMaxDuration(4, 'MiniMax-H3-Max'), 5)
  assert.equal(normalizeMiniMaxResolution(undefined, 'MiniMax-H3'), '768P')
  assert.equal(normalizeMiniMaxResolution('720p', 'MiniMax-H3'), '768P')
  assert.equal(normalizeMiniMaxResolution('1080p', 'MiniMax-H3'), '768P')
  assert.equal(normalizeMiniMaxResolution('2K', 'MiniMax-H3'), '2K')
  assert.equal(normalizeMiniMaxResolution('2K', 'MiniMax-H3-Max'), '768P')
  assert.equal(normalizeMiniMaxResolution('480p', 'MiniMax-H3-Max'), '480P')
  assert.equal(chooseMiniMaxVideoMode({ refImages: 2 }), 'r2va')
  assert.equal(chooseMiniMaxVideoMode({ firstFrame: true }), 'i2va')
  assert.equal(chooseMiniMaxVideoMode({}), 't2va')
  assert.throws(
    () => chooseMiniMaxVideoMode({ model: 'MiniMax-H3-Max', refImages: 1 }),
    /H3-Max/,
  )
})

test('reference stills use r2va and never mix first_frame', () => {
  const req = adapter.buildGenerateRequest(config, {
    id: 1,
    model: 'MiniMax-H3',
    prompt: '0-3秒：@林晚抬头。',
    imageUrl: 'https://cdn.example.com/first.jpg',
    referenceImageUrls: JSON.stringify([
      'https://cdn.example.com/scene.png',
      'https://cdn.example.com/hero.jpg',
    ]),
    duration: 10,
    aspectRatio: '9:16',
    resolution: '720p',
  })
  assert.equal(req.url, 'https://api.minimax.io/v2/video_generation')
  assert.equal(req.headers.Authorization, 'Bearer test-key')
  assert.equal(req.body.model, 'MiniMax-H3')
  assert.equal(req.body.duration, 10)
  assert.equal(req.body.resolution, '768P')
  assert.equal(req.body.ratio, '9:16')
  const roles = req.body.content.map((item: { role?: string; type: string }) => item.role || item.type)
  assert.deepEqual(roles, ['text', 'reference_image', 'reference_image', 'reference_image'])
  assert.equal(req.body.content.some((item: { role?: string }) => item.role === 'first_frame'), false)
  assert.equal(req.body.content[0].text, '0-3秒：@林晚抬头。')
})

test('text-only t2va requires a concrete ratio', () => {
  const req = adapter.buildGenerateRequest(config, {
    id: 2,
    prompt: 'A boy playing basketball by the sea',
    duration: 5,
    aspectRatio: 'adaptive',
  })
  assert.equal(req.body.ratio, '16:9')
  assert.equal(req.body.resolution, '768P')
  assert.equal(req.body.content.length, 1)
  assert.equal(req.body.content[0].type, 'text')
})

test('first/last frame i2va omits ratio and reference_image', () => {
  const req = adapter.buildGenerateRequest(config, {
    id: 3,
    prompt: 'Pull focus to the people in the background.',
    firstFrameUrl: 'https://cdn.example.com/start.png',
    lastFrameUrl: 'https://cdn.example.com/end.png',
    duration: 5,
    aspectRatio: '16:9',
    resolution: '1080p',
  })
  assert.equal(req.body.resolution, '768P')
  assert.equal(req.body.ratio, undefined)
  assert.deepEqual(
    req.body.content.map((item: { role?: string; type: string }) => item.role || item.type),
    ['text', 'first_frame', 'last_frame'],
  )
})

test('reference audio carries role=reference_audio', () => {
  const req = adapter.buildGenerateRequest(config, {
    id: 4,
    prompt: 'Character speaks. Voice timbre follows reference audio 1.',
    referenceImageUrls: JSON.stringify(['https://cdn.example.com/hero.jpg']),
    referenceAudioUrls: JSON.stringify(['https://cdn.example.com/voice.mp3']),
    duration: 5,
  })
  const audio = req.body.content.find((item: { type: string }) => item.type === 'audio_url')
  assert.equal(audio.role, 'reference_audio')
  assert.equal(audio.audio_url.url, 'https://cdn.example.com/voice.mp3')
})

test('poll maps official task statuses and create errors', () => {
  assert.deepEqual(
    adapter.parsePollResponse({
      task: { status: 'succeeded', content: { url: 'https://cdn.example.com/out.mp4' } },
    }),
    { status: 'completed', videoUrl: 'https://cdn.example.com/out.mp4' },
  )
  assert.equal(adapter.parsePollResponse({ task: { status: 'queued' } }).status, 'processing')
  assert.equal(adapter.parsePollResponse({ task: { status: 'running' } }).status, 'processing')
  const failed = adapter.parsePollResponse({
    task: { status: 'failed', error: { code: '1026', message: 'video description contains sensitive content' } },
  })
  assert.equal(failed.status, 'failed')
  assert.match(String(failed.error), /1026/)
  assert.deepEqual(
    adapter.parseGenerateResponse({ task_id: '424010985738629' }),
    { isAsync: true, taskId: '424010985738629' },
  )
  assert.throws(
    () => adapter.parseGenerateResponse({
      type: 'error',
      error: { type: 'bad_request_error', message: 'invalid params, content must include a non-empty text item (2013)' },
    }),
    /non-empty text/,
  )
})

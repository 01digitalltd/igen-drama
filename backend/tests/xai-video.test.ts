import { test } from 'node:test'
import assert from 'node:assert/strict'
import { XaiVideoAdapter, XAI_MODERATION_BLOCK_ZH_HANT } from '../src/services/adapters/xai-video.ts'

const fullModel = {
  provider: 'xai',
  baseUrl: 'https://api.x.ai/v1',
  apiKey: 'test-key',
  model: 'grok-imagine-video-1.5',
}

const liteModel = {
  ...fullModel,
  model: 'grok-imagine-video-1.5-lite',
}

const adapter = new XaiVideoAdapter()

test('xAI reference-to-video request uses preset voices and 480p', () => {
  const request = adapter.buildGenerateRequest(fullModel, {
    id: 1,
    prompt: '<IMAGE_0> says hello',
    duration: 12,
    aspectRatio: '16:9',
    resolution: '1080p',
    referenceImageUrls: JSON.stringify(['https://cdn.example/a.png', 'https://cdn.example/b.png']),
    xaiReferenceAudios: JSON.stringify([
      { voiceId: 'ara', speaker: '旁白', kind: 'narrator' },
      { voiceId: 'rex', speaker: '志遠', kind: 'character' },
    ]),
    referenceAudioUrls: JSON.stringify(['https://cdn.example/vo.wav']),
  })

  assert.equal(request.url, 'https://api.x.ai/v1/videos/generations')
  assert.equal(request.headers.Authorization, 'Bearer test-key')
  assert.equal(request.body.model, 'grok-imagine-video-1.5')
  assert.equal(request.body.duration, 12)
  assert.equal(request.body.resolution, '480p')
  assert.equal(request.body.aspect_ratio, '16:9')
  assert.deepEqual(request.body.reference_images, [
    { url: 'https://cdn.example/a.png' },
    { url: 'https://cdn.example/b.png' },
  ])
  assert.deepEqual(request.body.reference_audios, [
    { voice_id: 'ara' },
    { voice_id: 'rex' },
  ])
  assert.equal(request.body.image, undefined)
  assert.equal(JSON.stringify(request.body).includes('vo.wav'), false)
})

test('xAI pins a storyboard still as the opening frame without dropping asset refs', () => {
  const request = adapter.buildGenerateRequest(fullModel, {
    id: 3,
    prompt: '<IMAGE_0> is the storyboard still. <IMAGE_1> is the host.',
    imageUrl: 'https://cdn.example/storyboard.png',
    referenceImageUrls: JSON.stringify(['https://cdn.example/host.png']),
    duration: 8,
    aspectRatio: '9:16',
  })
  assert.deepEqual(request.body.image, { url: 'https://cdn.example/storyboard.png' })
  assert.deepEqual(request.body.reference_images, [{ url: 'https://cdn.example/host.png' }])
  assert.equal(request.body.last_frame, undefined)
})

test('xAI pins the next same-scene still as the last frame', () => {
  const request = adapter.buildGenerateRequest(fullModel, {
    id: 5,
    prompt: '<IMAGE_0> turns toward the door.',
    imageUrl: 'https://cdn.example/storyboard.png',
    lastFrameUrl: 'https://cdn.example/next.png',
    referenceImageUrls: JSON.stringify(['https://cdn.example/host.png']),
    duration: 8,
    aspectRatio: '16:9',
  })
  assert.deepEqual(request.body.image, { url: 'https://cdn.example/storyboard.png' })
  assert.deepEqual(request.body.last_frame, { url: 'https://cdn.example/next.png' })
  assert.deepEqual(request.body.reference_images, [{ url: 'https://cdn.example/host.png' }])
})

test('xAI lite sends one opening image and drops reference images', () => {
  const request = adapter.buildGenerateRequest(liteModel, {
    id: 4,
    prompt: '<IMAGE_0> sits beside <IMAGE_1>.',
    imageUrl: 'https://cdn.example/storyboard.png',
    referenceImageUrls: JSON.stringify(['https://cdn.example/host.png']),
    xaiReferenceAudios: JSON.stringify([{ voiceId: 'ara', speaker: '旁白', kind: 'narrator' }]),
    lastFrameUrl: 'https://cdn.example/next.png',
    duration: 8,
    aspectRatio: '16:9',
  })
  assert.equal(request.body.model, 'grok-imagine-video-1.5-lite')
  assert.deepEqual(request.body.image, { url: 'https://cdn.example/storyboard.png' })
  assert.equal(request.body.reference_images, undefined)
  assert.equal(request.body.reference_audios, undefined)
  assert.equal(request.body.last_frame, undefined)
})

test('xAI clamps duration and unknown aspect ratios', () => {
  const request = adapter.buildGenerateRequest(liteModel, {
    id: 2,
    prompt: 'walk',
    duration: 30,
    aspectRatio: '21:9',
  })
  assert.equal(request.body.duration, 15)
  assert.equal(request.body.aspect_ratio, '16:9')
})

test('xAI poll maps moderation failure and a finished url', () => {
  assert.equal(adapter.parseGenerateResponse({ request_id: 'req-1' }).taskId, 'req-1')
  assert.deepEqual(adapter.parsePollResponse({ status: 'pending', progress: 50 }), { status: 'processing' })
  assert.deepEqual(
    adapter.parsePollResponse({
      status: 'done',
      video: { url: 'https://vidgen.x.ai/clip.mp4', respect_moderation: true },
    }),
    { status: 'completed', videoUrl: 'https://vidgen.x.ai/clip.mp4' },
  )
  assert.equal(
    adapter.parsePollResponse({
      status: 'done',
      video: { url: '', respect_moderation: false },
    }).error,
    XAI_MODERATION_BLOCK_ZH_HANT,
  )
  assert.match(adapter.parsePollResponse({
    status: 'failed',
    error: { code: 'invalid_argument', message: 'bad duration' },
  }).error || '', /invalid_argument/)
})

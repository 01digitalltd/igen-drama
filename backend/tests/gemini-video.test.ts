import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GeminiVideoAdapter,
  chooseOmniVideoTask,
  isOmniVideoModel,
  normalizeOmniAspectRatio,
  normalizeOmniDurationSeconds,
  toOmniImageInput,
  withOmniReferenceGuide,
} from '../src/services/adapters/gemini-video.ts'

const adapter = new GeminiVideoAdapter()
const config = {
  provider: 'gemini',
  baseUrl: 'https://generativelanguage.googleapis.com',
  apiKey: 'test-key',
  model: 'gemini-omni-flash-preview',
}

test('Omni model detection and duration/aspect clamps', () => {
  assert.equal(isOmniVideoModel('gemini-omni-flash-preview'), true)
  assert.equal(isOmniVideoModel('gemini-omni-1.1-flash'), true)
  assert.equal(isOmniVideoModel('gemini-3.1-flash-image'), false)
  assert.equal(normalizeOmniDurationSeconds(15), 10)
  assert.equal(normalizeOmniDurationSeconds(2), 3)
  assert.equal(normalizeOmniAspectRatio('9:16'), '9:16')
  assert.equal(normalizeOmniAspectRatio('adaptive'), '16:9')
  assert.equal(chooseOmniVideoTask(0), 'text_to_video')
  assert.equal(chooseOmniVideoTask(1), 'reference_to_video')
  assert.equal(chooseOmniVideoTask(1, { literalFirstFrame: true }), 'image_to_video')
  assert.equal(chooseOmniVideoTask(3), 'reference_to_video')
  assert.match(
    withOmniReferenceGuide('抬头。', 'reference_to_video'),
    /should not be used as literal initial frames/,
  )
})

test('reference stills become Interactions image inputs', () => {
  const dataUrl = toOmniImageInput('data:image/png;base64,aaa')
  assert.deepEqual(dataUrl, { type: 'image', mime_type: 'image/png', data: 'aaa' })
  const remote = toOmniImageInput('https://cdn.example.com/hero.jpg')
  assert.equal(remote?.type, 'image')
  assert.equal(remote?.uri, 'https://cdn.example.com/hero.jpg')
  assert.equal(remote?.mime_type, 'image/jpeg')
})

test('buildGenerateRequest uses Interactions API with background poll', () => {
  const req = adapter.buildGenerateRequest(config, {
    id: 1,
    prompt: '0-3秒：@小明抬头。',
    referenceImageUrls: JSON.stringify([
      'data:image/jpeg;base64,abc',
      'https://cdn.example.com/scene.png',
    ]),
    duration: 12,
    aspectRatio: '9:16',
  })
  assert.match(req.url, /\/v1beta\/interactions/)
  assert.match(req.url, /key=test-key/)
  assert.equal(req.headers['x-goog-api-key'], 'test-key')
  assert.equal(req.body.model, 'gemini-omni-flash-preview')
  assert.equal(req.body.background, true)
  assert.equal(req.body.generation_config.video_config.task, 'reference_to_video')
  assert.equal(req.body.response_format.duration, '10s')
  assert.equal(req.body.response_format.aspect_ratio, '9:16')
  assert.equal(req.body.input[0].type, 'text')
  assert.match(req.body.input[0].text, /should not be used as literal initial frames/)
  assert.equal(req.body.input.filter((item: { type: string }) => item.type === 'image').length, 2)
})

test('a single reference still uses reference_to_video, not image_to_video', () => {
  const req = adapter.buildGenerateRequest(config, {
    id: 2,
    prompt: '小明转身离开。',
    referenceImageUrls: JSON.stringify(['https://cdn.example.com/hero.jpg']),
    duration: 5,
    aspectRatio: '9:16',
  })
  assert.equal(req.body.generation_config.video_config.task, 'reference_to_video')
  assert.equal(req.body.input.filter((item: { type: string }) => item.type === 'image').length, 1)
})

test('a dedicated first frame without refs stays image_to_video', () => {
  const req = adapter.buildGenerateRequest(config, {
    id: 3,
    prompt: '镜头推进。',
    firstFrameUrl: 'https://cdn.example.com/start.jpg',
    duration: 5,
  })
  assert.equal(req.body.generation_config.video_config.task, 'image_to_video')
  assert.doesNotMatch(String(req.body.input[0].text), /literal initial frames/)
})

test('parseGenerateResponse polls in-progress interactions and reads REST video bytes', () => {
  const pending = adapter.parseGenerateResponse({ id: 'v1_abc', status: 'in_progress' })
  assert.deepEqual(pending, { isAsync: true, taskId: 'v1_abc' })

  const done = adapter.parseGenerateResponse({
    id: 'v1_done',
    status: 'completed',
    steps: [
      {
        type: 'model_output',
        content: [{ type: 'video', mime_type: 'video/mp4', data: 'A'.repeat(100) }],
      },
    ],
  })
  assert.equal(done.isAsync, false)
  assert.equal(adapter.extractVideoBase64({
    steps: [{ type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', data: 'A'.repeat(100) }] }],
  })?.mimeType, 'video/mp4')

  const poll = adapter.buildPollRequest(config, 'v1_abc')
  assert.match(poll.url, /\/v1beta\/interactions\/v1_abc/)
  const pollResp = adapter.parsePollResponse({
    id: 'v1_abc',
    status: 'completed',
    steps: [{ type: 'model_output', content: [{ type: 'video', uri: 'https://files.example/out.mp4' }] }],
  })
  assert.equal(pollResp.status, 'completed')
  assert.equal(pollResp.videoUrl, 'https://files.example/out.mp4')
})

test('failed Omni interactions surface as failed poll status', () => {
  assert.throws(
    () => adapter.parseGenerateResponse({ status: 'failed', error: { message: 'blocked' } }),
    /blocked/,
  )
  const poll = adapter.parsePollResponse({ status: 'failed', error: { message: 'safety' } })
  assert.equal(poll.status, 'failed')
  assert.match(String(poll.error), /safety/)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OpenAIImageAdapter } from '../src/services/adapters/openai-image.ts'

const adapter = new OpenAIImageAdapter()
const apimart = {
  provider: 'openai',
  baseUrl: 'https://api.apimart.ai',
  apiKey: 'sk-proxy',
  model: 'gpt-image-2',
}
const openai = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com',
  apiKey: 'sk-openai',
  model: 'gpt-image-2',
}

test('APIMart gpt-image-2 submits aspect size to /v1/images/generations', () => {
  const req = adapter.buildGenerateRequest(apimart, {
    id: 1,
    prompt: 'a character in an office',
    size: '1920x1080',
  })

  assert.equal(req.url, 'https://api.apimart.ai/v1/images/generations')
  assert.equal(req.body.model, 'gpt-image-2')
  assert.equal(req.body.size, '16:9')
  assert.equal(req.body.quality, 'high')
  assert.equal(req.body.resolution, '2k')
  assert.equal(req.body.n, undefined)
  assert.equal(req.body.response_format, undefined)
  assert.equal(req.body.image_urls, undefined)
  assert.equal(req.headers.Authorization, 'Bearer sk-proxy')
})

test('APIMart gpt-image-2 unwraps nested task_id', () => {
  const parsed = adapter.parseGenerateResponse({
    code: 200,
    data: { task_id: 'task_abc' },
  })
  assert.equal(parsed.isAsync, true)
  assert.equal(parsed.taskId, 'task_abc')
})

test('APIMart gpt-image-2 polls GET /v1/tasks/:id', () => {
  const req = adapter.buildPollRequest(apimart, 'task_abc')
  assert.equal(req.url, 'https://api.apimart.ai/v1/tasks/task_abc')
  assert.equal(req.method, 'GET')
})

test('APIMart gpt-image-2 poll extracts result.images[].url', () => {
  const parsed = adapter.parsePollResponse({
    code: 200,
    data: {
      status: 'completed',
      result: { images: [{ url: 'https://cdn.example/x.png' }] },
    },
  })
  assert.equal(parsed.status, 'completed')
  assert.equal(parsed.imageUrl, 'https://cdn.example/x.png')
})

test('official OpenAI still polls /v1/images/task/:id with pixel size', () => {
  const gen = adapter.buildGenerateRequest(openai, {
    id: 1,
    prompt: 'a character in an office',
    size: '1920x1080',
  })
  assert.equal(gen.body.size, '1920x1088')
  assert.equal(gen.body.n, 1)

  const poll = adapter.buildPollRequest(openai, 'task_abc')
  assert.equal(poll.url, 'https://api.openai.com/v1/images/task/task_abc')
})

test('APIMart gpt-image-2 sends asset stills as image_urls', () => {
  const req = adapter.buildGenerateRequest(apimart, {
    id: 1,
    prompt: '单帧分镜静帧，锁定参考图',
    size: '1920x1080',
    referenceImages: JSON.stringify([
      'data:image/jpeg;base64,aaa',
      'data:image/jpeg;base64,bbb',
    ]),
  })

  assert.equal(req.url, 'https://api.apimart.ai/v1/images/generations')
  assert.deepEqual(req.body.image_urls, [
    'data:image/jpeg;base64,aaa',
    'data:image/jpeg;base64,bbb',
  ])
})

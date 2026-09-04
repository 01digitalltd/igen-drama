import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('video tasks enqueue with concurrency 1 and can be cancelled', () => {
  const generation = read('src/services/generation.ts')
  const tasks = read('src/routes/tasks.ts')

  assert.match(generation, /VIDEO_MAX_CONCURRENT = 1/)
  assert.match(generation, /status: type === 'video' \? 'queued' : 'processing'/)
  assert.match(generation, /function enqueueVideo/)
  assert.match(generation, /async function pumpVideoQueue/)
  assert.match(generation, /export async function cancelGenerationTask/)
  assert.match(generation, /status: 'cancelled'/)
  assert.match(generation, /buildCancelRequest/)

  assert.match(tasks, /app\.post\('\/:id\/cancel'/)
  assert.match(tasks, /cancelGenerationTask\(id\)/)
})

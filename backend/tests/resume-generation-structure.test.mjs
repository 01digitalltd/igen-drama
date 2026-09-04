import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('startup resumes in-flight generation instead of failing all processing tasks', () => {
  const index = read('src/index.ts')
  const generation = read('src/services/generation.ts')
  const merge = read('src/services/ffmpeg-merge.ts')
  const ai = read('src/services/ai.ts')

  assert.doesNotMatch(index, /服务重启，生成任务中断，请重试/)
  assert.match(index, /resumeInterruptedTasks/)
  assert.match(index, /resumeInterruptedMerges/)

  assert.match(generation, /export async function resumeInterruptedTasks/)
  assert.match(generation, /resume-poll/)
  assert.match(generation, /resume-queue/)
  assert.match(generation, /status === 'queued'/)
  assert.match(generation, /VIDEO_MAX_CONCURRENT = 1/)
  assert.match(generation, /export async function cancelGenerationTask/)
  assert.match(generation, /allowInactive: true/)
  assert.match(generation, /configId: configId \|\| undefined/)
  assert.match(generation, /await pollTask\(/)

  assert.match(merge, /export async function resumeInterruptedMerges/)
  assert.match(merge, /status: 'processing'/)

  assert.match(ai, /opts\?: \{ allowInactive\?: boolean \}/)
})

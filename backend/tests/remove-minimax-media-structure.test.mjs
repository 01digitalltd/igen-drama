import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('../..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const exists = (path) => existsSync(new URL(path, root))

test('MiniMax image and video provider surfaces are removed', () => {
  const ai = read('backend/src/services/ai.ts')
  const route = read('backend/src/routes/aiConfigs.ts')
  const registry = read('backend/src/services/adapters/registry.ts')
  const settings = read('frontend/app/pages/settings.vue')
  const readme = read('README.md')

  assert.doesNotMatch(ai, /minimax/i)
  assert.doesNotMatch(route, /p === 'minimax'/i)
  assert.doesNotMatch(registry, /minimax/i)
  assert.doesNotMatch(settings, /minimax/i)
  assert.doesNotMatch(readme, /minimax/i)
  assert.equal(exists('backend/src/services/adapters/minimax-image.ts'), false)
  assert.equal(exists('backend/src/services/adapters/minimax-video.ts'), false)
})

test('startup removes saved MiniMax configurations', () => {
  const seed = read('backend/src/db/seed.ts')
  assert.match(seed, /deleteMany\(\{ provider: 'minimax' \}\)/)
  assert.match(seed, /schema\.aiServiceConfigs/)
  assert.match(seed, /schema\.aiServiceProviders/)
})

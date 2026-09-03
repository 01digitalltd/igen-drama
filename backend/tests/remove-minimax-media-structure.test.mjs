import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('../..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const exists = (path) => existsSync(new URL(path, root))

test('MiniMax image adapter stays removed; H3 video adapter is kept', () => {
  const ai = read('backend/src/services/ai.ts')
  const registry = read('backend/src/services/adapters/registry.ts')
  const settings = read('frontend/app/pages/settings.vue')

  assert.match(ai, /video:\s*\[\s*'gemini',\s*'volcengine',\s*'minimax'\s*\]/)
  assert.match(registry, /MiniMaxVideoAdapter/)
  assert.match(registry, /minimax:\s*new MiniMaxVideoAdapter\(\)/)
  assert.match(settings, /MiniMax-H3/)
  assert.match(settings, /https:\/\/api\.minimax\.io/)
  assert.equal(exists('backend/src/services/adapters/minimax-image.ts'), false)
  assert.equal(exists('backend/src/services/adapters/minimax-video.ts'), true)
})

test('startup keeps MiniMax video configs and seeds H3 from the TTS key', () => {
  const seed = read('backend/src/db/seed.ts')
  const configSeed = read('backend/src/services/config-seed.ts')

  assert.doesNotMatch(seed, /deleteMany\(\{ provider: 'minimax' \}\)/)
  assert.match(configSeed, /ensureMinimaxVideoConfig/)
  assert.match(configSeed, /MINIMAX_API_KEY/)
  assert.match(configSeed, /MINIMAX_TTS_BASE_URL/)
  assert.match(configSeed, /MiniMax-H3/)
  assert.match(configSeed, /api\.minimax\.io/)
})

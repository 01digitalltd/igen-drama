import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  APIMART_ASSET_IMAGE_MODEL,
  apimartAssetImageModel,
  isRealisticAssetImageJob,
} from '../src/services/image-model-policy.ts'

test('realistic character, scene, and prop stills use APIMart', () => {
  assert.equal(isRealisticAssetImageJob({ style: 'realistic', characterId: 1 }), true)
  assert.equal(isRealisticAssetImageJob({ style: 'realistic', sceneId: 2 }), true)
  assert.equal(isRealisticAssetImageJob({ style: 'realistic', propId: 3 }), true)
})

test('realistic storyboard stills use APIMart and other styles stay off', () => {
  assert.equal(isRealisticAssetImageJob({ style: 'realistic', storyboardId: 9 }), true)
  assert.equal(isRealisticAssetImageJob({
    style: 'realistic',
    storyboardId: 9,
    characterId: 1,
    sceneId: 2,
  }), true)
  assert.equal(isRealisticAssetImageJob({ style: '3d', storyboardId: 9 }), false)
  assert.equal(isRealisticAssetImageJob({ style: '3d', characterId: 1 }), false)
  assert.equal(isRealisticAssetImageJob({ style: 'realistic' }), false)
})

test('asset image model stays in the gpt-image-2 family', () => {
  assert.equal(apimartAssetImageModel(''), APIMART_ASSET_IMAGE_MODEL)
  assert.equal(apimartAssetImageModel('dall-e-3'), APIMART_ASSET_IMAGE_MODEL)
  assert.equal(apimartAssetImageModel('gpt-image-2'), 'gpt-image-2')
  assert.equal(apimartAssetImageModel('gpt-image-2-official'), 'gpt-image-2-official')
  assert.equal(apimartAssetImageModel('gpt-image-2.5-sunburst'), 'gpt-image-2.5-sunburst')
})

test('image generation routes realistic assets and storyboard stills to APIMart', () => {
  const generation = readFileSync(new URL('../src/services/generation.ts', import.meta.url), 'utf8')
  const seed = readFileSync(new URL('../src/services/config-seed.ts', import.meta.url), 'utf8')
  assert.match(generation, /apimartSizeForAspectRatio/)
  assert.match(generation, /isRealisticAssetImageJob/)
  assert.match(generation, /resolveApimartImageConfig/)
  assert.match(generation, /APIMART_ASSET_IMAGE_MISSING_MESSAGE/)
  assert.match(generation, /providers: \['openai'\]/)
  assert.match(seed, /ensureApimartImageConfig/)
  assert.match(seed, /platform-image-apimart/)
  assert.match(seed, /APIMART_API_KEY/)
  assert.match(seed, /priority: 60/)
})

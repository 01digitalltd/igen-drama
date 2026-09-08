import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('video processTask overlays character stills only for realistic dramas', () => {
  const generation = read('src/services/generation.ts')
  const processStart = generation.indexOf('async function processTask')
  const imageBranch = generation.indexOf("if (type === 'image')", processStart)
  const videoBranch = generation.indexOf('} else {', imageBranch)
  const videoEnd = generation.indexOf('logTaskProgress(label, \'request\'', videoBranch)
  const video = generation.slice(videoBranch, videoEnd)
  const helperStart = generation.indexOf('async function normalizeVideoReferenceUrlsWithCharacterGrid')
  const helper = generation.slice(helperStart, helperStart + 1800)

  assert.match(video, /isRealisticDramaStyle\(await resolveVideoDramaStyle\(record\)\)/)
  assert.match(video, /characterStillKeysForStoryboard/)
  assert.match(video, /normalizeVideoReferenceUrlsWithCharacterGrid/)
  assert.match(video, /composeVideoPromptAfterCharacterGrid\(prompt, overlaidCount\)/)
  assert.match(helper, /isCharacterMediaRef/)
  assert.match(helper, /overlayOrangeGridOnRef/)
  assert.match(generation, /overlayOrangeGridOnRef/)
})

test('character image generation still strips leftover grid copy and never overlays', () => {
  const generation = read('src/services/generation.ts')
  const imageStart = generation.indexOf("if (type === 'image')")
  const imageEnd = generation.indexOf('} else {', imageStart)
  const image = generation.slice(imageStart, imageEnd)

  assert.match(image, /stripCharacterFaceGridPrompt/)
  assert.doesNotMatch(image, /overlayOrangeGridOnRef/)
  assert.doesNotMatch(image, /composeVideoPromptAfterCharacterGrid/)
})

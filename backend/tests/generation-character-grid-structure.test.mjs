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
  assert.match(video, /isOmniVideoConfig\(config\.provider, record\.model\)/)
  assert.match(video, /overlayCharacterGrid/)
  assert.match(video, /characterStillKeysForStoryboard/)
  assert.match(video, /normalizeVideoReferenceUrlsWithCharacterGrid/)
  assert.match(video, /storyboardBoundStillUrls/)
  assert.match(video, /mergeVideoReferenceUrls/)
  assert.match(video, /rewriteSeedancePromptRefs/)
  assert.match(helper, /isCharacterMediaRef/)
  assert.match(helper, /overlayOrangeGridOnRef/)
  assert.match(generation, /overlayOrangeGridOnRef/)
})

test('video enqueue keeps MiniMax-H3 on the MiniMax adapter', () => {
  const generation = read('src/services/generation.ts')
  const uniqStart = generation.indexOf('async function generateVideoUniq')
  const uniq = generation.slice(uniqStart, generation.indexOf('async function createTask', uniqStart))
  assert.match(uniq, /resolveVideoServiceConfig/)
  assert.match(generation, /expectedVideoProvider/)
  assert.match(generation, /MINIMAX_H3_MISSING_MESSAGE/)
  assert.match(generation, /providers: \[want\]/)
})

test('character image generation still strips leftover grid copy and never overlays', () => {
  const generation = read('src/services/generation.ts')
  const imageStart = generation.indexOf("if (type === 'image')")
  const imageEnd = generation.indexOf('} else {', imageStart)
  const image = generation.slice(imageStart, imageEnd)

  assert.match(image, /stripCharacterFaceGridPrompt/)
  assert.match(image, /storyboardBoundStills/)
  assert.match(image, /lockStoryboardStillPrompt/)
  assert.match(image, /labeledStoryboardReferenceImages/)
  assert.match(image, /episodeContinuityStill/)
  assert.doesNotMatch(image, /overlayOrangeGridOnRef/)
  assert.doesNotMatch(image, /composeVideoPromptAfterCharacterGrid/)
})

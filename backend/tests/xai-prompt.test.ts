import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildShotImageRefs } from '../src/services/storyboard-prompt.ts'
import { orderXaiImageRefs, rewriteXaiPrompt } from '../src/services/xai-prompt.ts'

test('xAI reference order is character, scene, then prop', () => {
  const source = buildShotImageRefs({
    scene: { location: '咖啡廳', image_url: 'https://cdn.example/scene.png' },
    characters: [{ name: '志遠', image_url: 'https://cdn.example/hero.png' }],
    props: [{ name: '杯子', image_url: 'https://cdn.example/cup.png' }],
  })
  const ordered = orderXaiImageRefs(source)
  assert.deepEqual(ordered.map((ref) => ref.tag), ['<IMAGE_0>', '<IMAGE_1>', '<IMAGE_2>'])
  assert.deepEqual(ordered.map((ref) => ref.kind), ['character', 'scene', 'prop'])
})

test('stored Seedance and Omni tokens are rewritten onto the xAI array', () => {
  const source = buildShotImageRefs({
    scene: { location: '咖啡廳', image_url: 'https://cdn.example/scene.png' },
    characters: [{ name: '志遠', image_url: 'https://cdn.example/hero.png' }],
  })
  const ordered = orderXaiImageRefs(source)
  const rewritten = rewriteXaiPrompt(
    '@志遠 坐在 @咖啡廳。\n\n<IMAGE_REF_0> 是空鏡。\n\n[VO_AUDIO_REFS: @Audio 1 is 旁白]\n\n[AUDIO: Speak only the quoted lines. No background music.]',
    ordered,
    source,
  )
  assert.match(rewritten, /<IMAGE_0>/)
  assert.match(rewritten, /<IMAGE_1>/)
  assert.doesNotMatch(rewritten, /@志遠|@咖啡廳|IMAGE_REF|VO_AUDIO_REFS|Speak only/)
})

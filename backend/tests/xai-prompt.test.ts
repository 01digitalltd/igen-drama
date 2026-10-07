import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildShotImageRefs } from '../src/services/storyboard-prompt.ts'
import { fitXaiSpokenClip, orderXaiImageRefs, rewriteXaiPrompt } from '../src/services/xai-prompt.ts'

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

test('xAI gives a spoken line enough time and a silent tail', () => {
  const prompt = [
    '[0-3s] <IMAGE_0> sits at the desk.',
    '[3-6s] <IMAGE_0> says: "你今天终于肯过来看我了。"',
  ].join('\n')
  const fitted = fitXaiSpokenClip(prompt, 8)
  assert.ok(fitted.duration > 8)
  assert.ok(fitted.duration <= 15)
  assert.match(fitted.prompt, /\[3-8s\].*你今天终于肯过来看我了/)
  assert.match(fitted.prompt, /\[8-9s\] Hold\. The spoken line has already finished/)
  assert.match(fitted.prompt, /\[XAI_SPEECH:/)
  const again = fitXaiSpokenClip(fitted.prompt, fitted.duration)
  assert.equal(again.duration, fitted.duration)
  assert.equal(again.prompt, fitted.prompt)
})

test('xAI keeps a clip that has no spoken line', () => {
  const prompt = '[0-3s] <IMAGE_0> walks in.\n[3-8s] <IMAGE_0> sits down.'
  const fitted = fitXaiSpokenClip(prompt, 8)
  assert.equal(fitted.duration, 8)
  assert.equal(fitted.prompt, prompt)
})

test('xAI speech fit never exceeds 15 seconds', () => {
  const prompt = `[0-3s] says: "${'我'.repeat(80)}"`
  const fitted = fitXaiSpokenClip(prompt, 8)
  assert.equal(fitted.duration, 15)
  const ends = [...fitted.prompt.matchAll(/\[(\d+)-(\d+)s\]/g)].map((item) => Number(item[2]))
  assert.ok(Math.max(...ends) <= 15)
})

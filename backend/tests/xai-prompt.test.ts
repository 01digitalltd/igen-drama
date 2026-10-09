import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildShotImageRefs } from '../src/services/storyboard-prompt.ts'
import { fitXaiSpokenClip, orderXaiImageRefs, pinXaiStoryboardStill, rewriteXaiPrompt, xaiBeatImageIssues, xaiSpokenLineIssues } from '../src/services/xai-prompt.ts'

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

test('xAI keeps the storyboard lines instead of a shortened slogan', () => {
  const description = [
    '【鏡頭1】女主角坐在露天座位上，大口品嚐。女主角說：「哇！這個味道！太好吃了！」',
    '【鏡頭2】女主角拿著冰檸檬茶。女主角說：「吃完牛河，再來杯冰檸檬茶！地址在下面喔！」',
    '【鏡頭3】特寫女主角手中的冰檸檬茶。',
  ].join('\n')
  const prompt = [
    '[0-4s] <IMAGE_0> tastes the noodles.',
    '[4-8s] <IMAGE_0> says: "凍檸茶，正！"',
  ].join('\n')
  const issues = xaiSpokenLineIssues(prompt, description)
  assert.equal(issues.repeated.length, 0)
  assert.equal(issues.missing.length, 2)
})

test('xAI says each storyboard line once when every beat copied the first line', () => {
  const description = [
    '【鏡頭1】女主角坐在露天座位。女主角：（滿足地咀嚼）太好吃了！',
    '【鏡頭2】女主角拿著冰檸檬茶。女主角：（對鏡頭，開心）配冰檸檬茶，看底下地址與轉發！',
  ].join('\n')
  const prompt = [
    '[0-3s] 女主角坐在露天座位。女主角：（滿足地咀嚼）太好吃了！',
    '[3-6s] 她繼續品嚐。女主角：（滿足地咀嚼）太好吃了！',
    '[6-9s] 她拿起檸檬茶。女主角：（滿足地咀嚼）太好吃了！',
  ].join('\n')
  const issues = xaiSpokenLineIssues(prompt, description)
  assert.deepEqual(issues.repeated, ['太好吃了！'])
  assert.deepEqual(issues.missing, ['配冰檸檬茶，看底下地址與轉發！'])
})

test('xAI keeps a parenthetical line from shot 2 when the prompt only quoted shot 1', () => {
  const description = [
    '【鏡頭1】鏡頭切回女主角，她坐在餐廳的露天座位上，面前擺著一盤香氣四溢的乾炒牛河。她迫不及待地夾起一大口送入口中。女主角：（滿足地咀嚼）太好吃了！',
    '【鏡頭2】女主角手裡拿著一杯冰檸檬茶，對著鏡頭。女主角：（對鏡頭，開心）配冰檸檬茶，看底下地址與轉發！',
  ].join('\n')
  const prompt = '[0-4s] <IMAGE_0> tastes the noodles and says: "太好吃了！"'
  const issues = xaiSpokenLineIssues(prompt, description)
  assert.equal(issues.repeated.length, 0)
  assert.deepEqual(issues.missing, ['配冰檸檬茶，看底下地址與轉發！'])
})

test('a quoted line inside the timeline counts as that storyboard line', () => {
  const description = [
    '【鏡頭1】女主角坐在露天座位。女主角：（滿足地咀嚼）太好吃了！',
    '【鏡頭2】女主角拿著冰檸檬茶。女主角：（對鏡頭，開心）配冰檸檬茶，看底下地址與轉發！',
  ].join('\n')
  const prompt = [
    '[0-3s] <IMAGE_0> eats and says: "太好吃了！"',
    '[3-8s] <IMAGE_0> holds the drink and says: "配冰檸檬茶，看底下地址與轉發！"',
  ].join('\n')
  const issues = xaiSpokenLineIssues(prompt, description)
  assert.deepEqual(issues.missing, [])
  assert.deepEqual(issues.repeated, [])
})

test('a spoken line outside the timeline is still missing', () => {
  const description = [
    '【鏡頭1】女主角坐在露天座位。女主角：（滿足地咀嚼）太好吃了！',
    '【鏡頭2】女主角拿著冰檸檬茶。女主角：（對鏡頭，開心）配冰檸檬茶，看底下地址與轉發！',
  ].join('\n')
  const prompt = [
    '[0-1s] <IMAGE_0> 女主角坐在露天座位上吃乾炒牛河。',
    '[1-4s] 女主角說：「太好吃了！」',
    '[4-5s] 女主角手裡拿著一杯冰檸檬茶。',
    '她說：「配冰檸檬茶，看底下地址與轉發！」',
  ].join('\n')
  const issues = xaiSpokenLineIssues(prompt, description)
  assert.deepEqual(issues.missing, ['配冰檸檬茶，看底下地址與轉發！'])
})

test('a beat that names a reference must use that reference image', () => {
  const refs = [
    { index: 0, name: '女主角' },
    { index: 1, name: '露天座位' },
    { index: 2, name: '乾炒牛河' },
    { index: 3, name: '冰檸檬茶' },
    { index: 4, name: '品牌Logo' },
  ]
  const prompt = [
    '[0-3s] <IMAGE_0><IMAGE_1><IMAGE_3> 女主角坐在露天座位上，面前是乾炒牛河。',
    '[3-6s] <IMAGE_0><IMAGE_1><IMAGE_4> 女主角手裡拿著一杯冰檸檬茶。',
  ].join('\n')
  assert.deepEqual(xaiBeatImageIssues(prompt, refs), ['乾炒牛河', '冰檸檬茶'])
})

test('a trailing spoken line lengthens the last beat', () => {
  const prompt = [
    '[0-1s] <IMAGE_0> eats.',
    '[1-4s] <IMAGE_0> says: "太好吃了！"',
    '[4-5s] <IMAGE_0> holds a drink.',
    '她說：「配冰檸檬茶，看底下地址與轉發！」',
  ].join('\n')
  const fitted = fitXaiSpokenClip(prompt, 8)
  assert.match(fitted.prompt, /\[1-4s\]/)
  assert.match(fitted.prompt, /\[4-11s\]/)
})

test('pinning the storyboard still shifts asset tokens and keeps IMAGE_0 for the still', () => {
  const pinned = pinXaiStoryboardStill('[0-4s] <IMAGE_0> tastes the noodles from <IMAGE_1>.')
  assert.match(pinned, /<IMAGE_1> tastes the noodles from <IMAGE_2>/)
  assert.match(pinned, /<IMAGE_0> is shot 1 of this clip and the exact opening instant/)
  assert.equal(pinXaiStoryboardStill(pinned), pinned)
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

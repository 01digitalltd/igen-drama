import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveStoryboardVideoPrompt, parseVideoPromptDurationSeconds, resolveVideoGenerationDuration, buildShotImageRefs, rewriteSeedancePromptRefs, innerShotsOverflow } from '../src/services/storyboard-prompt.ts'

test('prefers dedicated video_prompt over storyboard description', () => {
  assert.equal(
    resolveStoryboardVideoPrompt({
      videoPrompt: '  角色走向窗边  ',
      description: '【镜头1】室内，日',
      atmosphere: '冷清',
    }),
    '角色走向窗边',
  )
})

test('falls back to breakdown description and atmosphere when video_prompt is empty', () => {
  assert.equal(
    resolveStoryboardVideoPrompt({
      video_prompt: '',
      description: '【镜头1】男主推开门',
      atmosphere: '黄昏暖光',
    }),
    '【镜头1】男主推开门\n\n黄昏暖光',
  )
  assert.equal(
    resolveStoryboardVideoPrompt({ description: '空镜：雨夜街道' }),
    '空镜：雨夜街道',
  )
  assert.equal(resolveStoryboardVideoPrompt({}), '')
})

test('reads total seconds from video_prompt timeline ranges', () => {
  assert.equal(
    parseVideoPromptDurationSeconds(
      '0-3秒：@咖啡厅，近景。\n3-6秒：切到门口。\n6-9秒：切回中景。',
    ),
    9,
  )
  assert.equal(parseVideoPromptDurationSeconds('0-3s: walk\n3-6s: turn'), 6)
  assert.equal(
    parseVideoPromptDurationSeconds('[0-3s] @咖啡厅。\n[3-9s] 切回中景。无对白。'),
    9,
  )
  assert.equal(parseVideoPromptDurationSeconds('角色走向窗边'), null)
})

test('generation duration follows prompt timeline and clamps to the model', () => {
  const prompt = '0-3秒：A\n3-6秒：B\n6-9秒：C\n9-12秒：D'
  assert.equal(
    resolveVideoGenerationDuration({ prompt, shotDuration: 8, provider: 'minimax', model: 'MiniMax-H3' }),
    12,
  )
  assert.equal(
    resolveVideoGenerationDuration({ prompt, shotDuration: 12, provider: 'gemini', model: 'gemini-omni-flash-preview' }),
    10,
  )
  assert.equal(
    resolveVideoGenerationDuration({ prompt: '', shotDuration: 9, provider: 'minimax' }),
    9,
  )
  assert.equal(
    resolveVideoGenerationDuration({ prompt, shotDuration: 7, provider: 'xai', model: 'grok-imagine-video-1.5' }),
    7,
  )
})

test('Omni image_refs follow scene then character then prop order', () => {
  assert.deepEqual(
    buildShotImageRefs({
      scene: { location: '咖啡厅', image_url: 'static/cafe.png' },
      characters: [
        { name: '小明', image_url: 'static/ming.png' },
        { name: '路人', image_url: '' },
      ],
      props: [{ name: '信', image_url: 'static/letter.png' }],
    }),
    [
      { index: 0, tag: '<IMAGE_REF_0>', kind: 'scene', name: '咖啡厅', url: 'static/cafe.png' },
      { index: 1, tag: '<IMAGE_REF_1>', kind: 'character', name: '小明', url: 'static/ming.png' },
      { index: 2, tag: '<IMAGE_REF_2>', kind: 'prop', name: '信', url: 'static/letter.png' },
    ],
  )
})

test('image_refs fall back to uploaded local_path when image_url is empty', () => {
  assert.deepEqual(
    buildShotImageRefs({
      characters: [{ name: '小華', image_url: '', local_path: 'static/upload.png' }],
    }),
    [{ index: 0, tag: '<IMAGE_REF_0>', kind: 'character', name: '小華', url: 'static/upload.png' }],
  )
})

test('rewrites Omni IMAGE_REF tags to MiniMax @图片N', () => {
  assert.equal(
    rewriteSeedancePromptRefs('[0-3s] <IMAGE_REF_0> 攝影棚，<IMAGE_REF_1> 主持人。'),
    '[0-3s] @图片1 攝影棚，@图片2 主持人。',
  )
})

test('five spoken cuts do not fit in nine seconds', () => {
  const description = [
    '【镜头1】人物：阿仪。阿仪说：「好。」',
    '【镜头2】人物：陈生。陈生说：「行。」',
    '【镜头3】人物：阿仪。阿仪说：「走。」',
    '【镜头4】人物：陈生。陈生说：「等。」',
    '【镜头5】人物：阿仪。阿仪说：「来。」',
  ].join('\n')
  const hit = innerShotsOverflow(description, 9)
  assert.equal(hit?.beats, 5)
  assert.equal(hit?.spoken, 5)
  assert.ok((hit?.needed || 0) > 9)
})

test('two spoken cuts fit in nine seconds and one unmarked shot is not split', () => {
  const two = '【镜头1】阿仪说：「今晚开始。」\n【镜头2】陈生说：「这些给你。」'
  assert.equal(innerShotsOverflow(two, 9), null)
  assert.equal(innerShotsOverflow('阿仪说：「一句也不拆。」', 4), null)
})

test('five spoken lines in one block still do not fit in nine seconds', () => {
  const description = [
    '【镜头1】阿仪说：「好。」陈生说：「行。」阿仪说：「走。」陈生说：「等。」阿仪说：「来。」',
  ].join('\n')
  const hit = innerShotsOverflow(description, 9)
  assert.equal(hit?.spoken, 5)
  assert.ok((hit?.needed || 0) > 9)
})

test('xAI speech rate keeps a long line from borrowing a faster model budget', () => {
  const description = '【镜头1】阿仪说：「今晚就从这张梳妆台开始。」\n【镜头2】陈生说：「这些都给你。」'
  assert.equal(innerShotsOverflow(description, 8), null)
  const xai = innerShotsOverflow(description, 8, { charsPerSecond: 2.5, tailSeconds: 1 })
  assert.ok((xai?.needed || 0) > 8)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveStoryboardVideoPrompt, parseVideoPromptDurationSeconds, resolveVideoGenerationDuration, buildShotImageRefs, rewriteSeedancePromptRefs, innerShotsOverflow, formatInnerShotOverflow, formatEpisodeFloorStop, storyboardPlaceKeys, sameSceneSplits, formatSameSceneSplits, formatMixedScenes, estimateScriptDuration, beatBudgetForSkill, pickNextSameSceneStill } from '../src/services/storyboard-prompt.ts'

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

test('a short clip with two shots is lengthened instead of split into shot 1 only', () => {
  const two = '【镜头1】阿仪说：「今晚开始。」\n【镜头2】陈生说：「这些给你。」'
  const hit = innerShotsOverflow(two, 4)
  assert.ok(hit)
  const message = formatInnerShotOverflow([{ shotNumber: 1, duration: 4, ...hit! }], 15)
  assert.match(message, /把这段 duration 改成 \d+ 秒/)
  assert.match(message, /只把上面的 duration 改成写明的秒数/)
  assert.doesNotMatch(message, /拆/)
  assert.doesNotMatch(message, /合并/)
})

test('a scene longer than the cap is split instead of kept together', () => {
  const line = '今晚开始把这件事完整说完喔呀'
  const description = [1, 2, 3, 4, 5].map((n) => `【镜头${n}】人物：甲。甲说：「${line}」`).join('\n')
  const hit = innerShotsOverflow(description, 9)
  assert.ok(hit)
  assert.ok((hit?.needed || 0) > 15)
  const message = formatInnerShotOverflow([{ shotNumber: 3, duration: 8, ...hit! }], 15)
  assert.match(message, /已经超过 15 秒/)
  assert.match(message, /拆到下一个分镜/)
  assert.match(message, /不要为了同一场景硬放在一段/)
  assert.doesNotMatch(message, /镜头2、镜头3留在这一段/)
  const beat = (n: number) => `【镜头${n}】场景：客厅。人物：甲。甲说：「${line}」`
  assert.equal(sameSceneSplits([
    { shotNumber: 3, description: [beat(1), beat(2), beat(3)].join('\n'), duration: 15 },
    { shotNumber: 4, description: [beat(1), beat(2)].join('\n'), duration: 8 },
  ], 15).length, 0)
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

test('adjacent beats of one place stay together and a later place does not', () => {
  const living = '【镜头1】场景：阿仪家中 · 客厅。人物：阿仪。动作：阿仪坐下。'
  const livingNext = '【镜头1】场景：客厅。人物：阿仪、陈生。动作：陈生把花递给阿仪。'
  const bedroom = '【镜头1】场景：阿仪家中 · 卧室。人物：阿仪。动作：阿仪醒来。'
  assert.deepEqual(storyboardPlaceKeys(`${living}\n【镜头2】场景：卧室。人物：阿仪。动作：阿仪躺下。`), ['客厅', '卧室'])
  const early = sameSceneSplits([
    { shotNumber: 1, description: living, duration: 8 },
    { shotNumber: 2, description: livingNext, duration: 8 },
  ], 15)
  assert.equal(early.length, 1)
  assert.match(formatSameSceneSplits(early, 15), /客厅/)
  assert.match(formatMixedScenes(1, ['客厅', '卧室']), /换场景才放到下一个分镜/)
  const ordered = sameSceneSplits([
    { shotNumber: 1, description: living, duration: 8 },
    { shotNumber: 2, description: bedroom, duration: 8 },
    { shotNumber: 3, description: livingNext, duration: 8 },
  ], 15)
  assert.equal(ordered.length, 0)
  const line = '今晚开始把这件事完整说完喔呀'
  const crowded = [1, 2, 3].map((n) => `【镜头${n}】场景：客厅。人物：阿仪。阿仪说：「${line}」`).join('\n')
  const crowdedNext = [1, 2].map((n) => `【镜头${n}】场景：客厅。人物：阿仪。阿仪说：「${line}」`).join('\n')
  const full = sameSceneSplits([
    { shotNumber: 1, description: crowded, duration: 15 },
    { shotNumber: 2, description: crowdedNext, duration: 8 },
  ], 15)
  assert.equal(full.length, 0)
  assert.equal(sameSceneSplits([
    { shotNumber: 1, description: living, duration: 8 },
    { shotNumber: 2, description: livingNext, duration: 8 },
  ], 15, undefined, false).length, 0)
})

test('an episode that cannot hold its speech stops instead of asking for another save', () => {
  const message = formatEpisodeFloorStop(33, 30)
  assert.match(message, /^停止拆分镜：/)
  assert.match(message, /至少要 33 秒/)
  assert.match(message, /目标只有 30 秒/)
  assert.match(message, /不要再调用 save_storyboards/)
  assert.doesNotMatch(message, /重新调用/)
})

test('estimates the script before the model runs', () => {
  const line = '今晚開始把這件事完整說完喔呀'
  const spoken = [0, 1, 2, 3, 4].map((index) => `${index % 2 ? '乙' : '甲'}：（平靜）${line}。`).join('\n')
  const script = `## 外景 · 場景甲\n甲站在門口。\n\n## 內景 · 場景乙\n${spoken}`
  const estimate = estimateScriptDuration(script, { charsPerSecond: 2.5, tailSeconds: 1, shotMin: 4 })
  assert.ok(estimate.neededSeconds > 30)
  assert.equal(estimate.lines.length, 5)
  assert.equal(estimate.lines[0]?.speaker, '甲')
  assert.ok(estimate.lines.every((row) => row.seconds >= 3))
  const short = estimateScriptDuration('甲：（微笑）好。', { charsPerSecond: 2.5, tailSeconds: 1, shotMin: 4 })
  assert.ok(short.neededSeconds <= 30)
  assert.equal(beatBudgetForSkill('xai')?.charsPerSecond, 2.5)
  assert.equal(beatBudgetForSkill('seedance'), undefined)
})

test('the next storyboard still is pinned only when it is the same scene', () => {
  const current = { id: 1, storyboardNumber: 1, sceneId: 10, location: '甲地', composedImage: 'a.png' }
  const same = { id: 2, storyboardNumber: 2, sceneId: 10, location: '甲地', composedImage: 'b.png' }
  const other = { id: 3, storyboardNumber: 3, sceneId: 11, location: '乙地', composedImage: 'c.png' }
  const laterSame = { id: 4, storyboardNumber: 4, sceneId: 10, location: '甲地', composedImage: 'd.png' }
  assert.equal(pickNextSameSceneStill(current, [current, same, other, laterSame])?.id, 2)
  assert.equal(pickNextSameSceneStill(same, [current, same, other, laterSame]), null)
  assert.equal(pickNextSameSceneStill(
    { ...current, sceneId: null, location: '甲地' },
    [{ ...current, sceneId: null }, { ...same, sceneId: null, composedImage: '' }, other],
  ), null)
  assert.equal(pickNextSameSceneStill(
    { ...current, sceneId: null, location: '甲地' },
    [{ ...current, sceneId: null }, { ...same, sceneId: null }],
  )?.id, 2)
})

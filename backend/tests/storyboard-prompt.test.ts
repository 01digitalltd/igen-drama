import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveStoryboardVideoPrompt, parseVideoPromptDurationSeconds, resolveVideoGenerationDuration } from '../src/services/storyboard-prompt.ts'

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
})

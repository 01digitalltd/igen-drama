import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveStoryboardVideoPrompt } from '../src/services/storyboard-prompt.ts'

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

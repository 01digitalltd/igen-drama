import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractGenerateText, looksLikeVideoPrompt, videoPromptFromPayload } from '../src/services/video-prompt-text.ts'

test('looksLikeVideoPrompt recognizes MiniMax and Omni timelines', () => {
  assert.equal(looksLikeVideoPrompt('ok'), false)
  assert.equal(
    looksLikeVideoPrompt('0-3秒：@林晚抬头。\n3-6秒：@林晚走向窗边。'),
    true,
  )
  assert.equal(
    looksLikeVideoPrompt('[0-3s] <IMAGE_REF_0> 攝影棚，主持人开口。\n[3-6s] 无对白。'),
    true,
  )
})

test('videoPromptFromPayload reads structured JSON fields', () => {
  assert.equal(videoPromptFromPayload({ video_prompt: '  0-3秒：抬头  ' }), '0-3秒：抬头')
  assert.equal(videoPromptFromPayload({ prompt: '0-3秒：抬头' }), '0-3秒：抬头')
  assert.equal(videoPromptFromPayload('0-3秒：抬头'), '0-3秒：抬头')
  assert.equal(videoPromptFromPayload({}), '')
})

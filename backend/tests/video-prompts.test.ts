import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractGenerateText, looksLikeVideoPrompt } from '../src/services/video-prompt-text.ts'

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

test('extractGenerateText reads Mastra generate text', () => {
  assert.equal(extractGenerateText({ text: '  0-3秒：抬头  ' }), '0-3秒：抬头')
  assert.equal(extractGenerateText({ content: 'hello' }), 'hello')
  assert.equal(extractGenerateText(null), '')
  assert.equal(
    extractGenerateText({ text: '', steps: [{ text: '' }, { text: '  0-3秒：抬头  ' }] }),
    '0-3秒：抬头',
  )
})

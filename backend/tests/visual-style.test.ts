import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  appendVisualStyleDirective,
  videoVisualStyleText,
  visualStyleInstruction,
} from '../src/services/style-preset.ts'

test('3D video style forbids live-action even if the image preset says semi-realistic', () => {
  const text = videoVisualStyleText(
    '3d',
    '3D CG animation style, game-engine quality render, semi-realistic stylized characters',
  )
  assert.match(text, /3D CG animated/)
  assert.match(text, /NOT photorealistic live-action/)
  assert.match(text, /NOT real human actors/)
})

test('video prompt instruction pins 3D and skips empty style', () => {
  const threeD = visualStyleInstruction('3d')
  assert.match(threeD, /3D 漫剧/)
  assert.match(threeD, /禁止写成真人实拍/)
  assert.equal(visualStyleInstruction(''), '')
  assert.match(visualStyleInstruction('realistic'), /写实真人/)
})

test('generation prepends a visual-style tag without duplicating it', () => {
  const first = appendVisualStyleDirective('0-3秒：@小明转身。', '3d', '3D CG animation style')
  assert.match(first, /^\[VISUAL_STYLE: 3d \|/)
  assert.match(first, /NOT photorealistic live-action/)
  assert.match(first, /0-3秒：@小明转身。/)
  const second = appendVisualStyleDirective(first, '3d', '3D CG animation style')
  assert.equal(second, first)
})

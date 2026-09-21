import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  appendAssetRestyleDirective,
  appendVisualStyleDirective,
  videoVisualStyleText,
  visualStyleInstruction,
} from '../src/services/style-preset.ts'

test('3D video style forbids live-action even if the image preset says semi-realistic', () => {
  const text = videoVisualStyleText(
    '3d',
    '3D chibi CG animation style, game-engine quality render, super-deformed characters',
  )
  assert.match(text, /3D chibi CG animated/)
  assert.match(text, /Not live-action camera footage/)
  assert.match(text, /restyle rooms, people and packaging/)
  assert.doesNotMatch(text, /skin pores/)
  assert.doesNotMatch(text, /real human/)
})

test('video prompt instruction pins 3D and skips empty style', () => {
  const threeD = visualStyleInstruction('3d')
  assert.match(threeD, /3D Chibi/)
  assert.match(threeD, /禁止写成真人实拍/)
  assert.match(threeD, /转成 3D Chibi CG/)
  assert.equal(visualStyleInstruction(''), '')
  assert.match(visualStyleInstruction('realistic'), /写实真人/)
})

test('generation prepends a visual-style tag without duplicating it', () => {
  const first = appendVisualStyleDirective('0-3秒：@小明转身。', '3d', '3D CG animation style')
  assert.match(first, /^\[VISUAL_STYLE: 3d \|/)
  assert.match(first, /Not live-action camera footage/)
  assert.match(first, /0-3秒：@小明转身。/)
  assert.match(first, /\[STYLE_LOCK\]/)
  assert.match(first, /Restyle every reference still/)
  const second = appendVisualStyleDirective(first, '3d', '3D CG animation style')
  assert.equal(second, first)
})

test('realistic style does not add a restyle lock', () => {
  const text = appendVisualStyleDirective('0-3秒：@小明转身。', 'realistic', 'photorealistic live-action')
  assert.match(text, /\[VISUAL_STYLE: realistic/)
  assert.doesNotMatch(text, /\[STYLE_LOCK\]/)
})

test('uploaded asset stills get a analyze-then-restyle prompt', () => {
  const first = appendAssetRestyleDirective('半身角色海报构图', 'character', '3d')
  assert.match(first, /【转风格｜必须遵守】/)
  assert.match(first, /用户提供的角色原图/)
  assert.match(first, /分析外形/)
  assert.match(first, /3D Chibi/)
  assert.match(first, /半身角色海报构图/)
  assert.equal(appendAssetRestyleDirective(first, 'character', 'anime'), first)
})

test('image generation restyles existing asset stills and skips brand logos', () => {
  const src = readFileSync(new URL('../src/services/generation.ts', import.meta.url), 'utf8')
  assert.match(src, /params = await attachAssetStillForRestyle\(params\)/)
  assert.match(src, /if \(isBrandLogoProp\(row\)\) return params/)
  assert.match(src, /labeledAssetReferenceImages/)
  assert.match(src, /先分析外形，再转成项目画风/)
})

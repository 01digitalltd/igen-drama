import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  stripCharacterFaceGridPrompt,
  stripVideoFaceGridPrompt,
} from '../src/services/face-grid.ts'

test('character image prompts no longer inject a face grid', () => {
  assert.equal(stripCharacterFaceGridPrompt('character turnaround'), 'character turnaround')
  assert.doesNotMatch(
    stripCharacterFaceGridPrompt('character turnaround'),
    /6x6 white grid|网格/,
  )
})

test('stored character grid overlays are stripped before generation', () => {
  const overlay =
    'character turnaround, overlay a 6x6 white grid across the entire image (pure white #FFFFFF, 100% opacity, 12px-thick lines); six columns by six rows spanning the full frame from edge to edge; the grid lines must cut through and visually split every facial feature (eyebrows, eyes, nose, mouth, ears) so no complete feature stays inside a single cell; covering people, clothing, background and all other content; the white grid must stay fully opaque and clearly visible'
  const stripped = stripCharacterFaceGridPrompt(overlay)
  assert.equal(stripped, 'character turnaround')
  assert.doesNotMatch(stripped, /6x6|grid|网格/)

  const chinese =
    '角色设定参考图，纯白背景，写实真人时整张图覆盖白色 6×6 网格（不透明度 100%、线宽 12px，铺满全画幅），网格线必须切开人物五官（眉、眼、鼻、口、耳），把五官分拆到不同格子，不得让完整五官落在同一格'
  assert.equal(stripCharacterFaceGridPrompt(chinese), '角色设定参考图，纯白背景')
})

test('legacy orange and 9x9 image grids are also stripped', () => {
  const orange =
    'character turnaround, on every visible human face only, overlay an ultra-fine orange mesh grid of hair-thin lines covering forehead, cheeks, nose, lips, chin and ears; do not cover hair, neck, body or clothing; the orange grid must stay clearly visible'
  assert.equal(stripCharacterFaceGridPrompt(orange), 'character turnaround')

  const nineByNine =
    'character turnaround, overlay a 9x9 white grid across the entire image (pure white #FFFFFF, 100% opacity, 12px-thick lines); nine columns by nine rows spanning the full frame from edge to edge; the grid lines must cut through and visually split every facial feature (eyebrows, eyes, nose, mouth, ears) so no complete feature stays inside a single cell; covering people, clothing, background and all other content; the white grid must stay fully opaque and clearly visible'
  assert.equal(stripCharacterFaceGridPrompt(nineByNine), 'character turnaround')
})

test('video prompts no longer ask to remove a face grid', () => {
  assert.equal(stripVideoFaceGridPrompt('0-3秒：@小明抬头。'), '0-3秒：@小明抬头。')
})

test('stored video grid-removal instructions are stripped before generation', () => {
  const next = stripVideoFaceGridPrompt(
    '0-3秒：@小明抬头。\n去掉参考图整张画面上的白色6×6网格（不透明度100%、线宽约12px），把被网格切开的五官重新拼成完整眉眼鼻口耳，还原无网格的自然画面，不得残留格子或白色线。Remove the white 6x6 grid covering the entire reference image (100% opacity, 12px-thick lines); reassemble split facial features into complete eyebrows, eyes, nose, mouth and ears; restore the natural scene with no lattice overlay.',
  )
  assert.equal(next, '0-3秒：@小明抬头。')
  assert.doesNotMatch(next, /网格|grid|facial features/i)
})

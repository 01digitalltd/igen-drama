import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  REALISTIC_FACE_GRID_IMAGE_PROMPT,
  REALISTIC_FACE_GRID_VIDEO_PROMPT,
  isRealisticStyle,
  withRealisticCharacterFaceGrid,
  withRealisticVideoFaceGridRemoval,
} from '../src/services/face-grid.ts'

test('only realistic style gets the face grid', () => {
  assert.equal(isRealisticStyle('realistic'), true)
  assert.equal(isRealisticStyle('3d'), false)
  assert.equal(
    withRealisticCharacterFaceGrid('3d', 'character turnaround'),
    'character turnaround',
  )
  assert.match(
    withRealisticCharacterFaceGrid('realistic', 'character turnaround'),
    /6x6 white grid across the entire image/,
  )
  assert.match(
    withRealisticCharacterFaceGrid('realistic', 'character turnaround'),
    /12px-thick/,
  )
})

test('video prompt asks to remove the full-image white 6x6 grid for realistic dramas', () => {
  const next = withRealisticVideoFaceGridRemoval('realistic', '0-3秒：@小明抬头。')
  assert.match(next, /去掉参考图整张画面上的白色6×6网格/)
  assert.match(next, /Remove the white 6x6 grid covering the entire reference image/)
  assert.doesNotMatch(next, /脸部/)
  assert.doesNotMatch(next, /orange/i)
  assert.equal(
    withRealisticVideoFaceGridRemoval('anime', '0-3秒：@小明抬头。'),
    '0-3秒：@小明抬头。',
  )
})

test('face-grid helpers are idempotent', () => {
  const once = withRealisticCharacterFaceGrid('realistic', 'hero close-up')
  assert.equal(withRealisticCharacterFaceGrid('realistic', once), once)
  const videoOnce = withRealisticVideoFaceGridRemoval('realistic', 'action')
  assert.equal(withRealisticVideoFaceGridRemoval('realistic', videoOnce), videoOnce)
  assert.ok(REALISTIC_FACE_GRID_IMAGE_PROMPT.includes('6x6'))
  assert.ok(REALISTIC_FACE_GRID_IMAGE_PROMPT.includes('#FFFFFF'))
  assert.ok(REALISTIC_FACE_GRID_IMAGE_PROMPT.includes('100% opacity'))
  assert.ok(REALISTIC_FACE_GRID_VIDEO_PROMPT.includes('白色6×6'))
})

test('legacy face-only grid prompt is replaced with a full-image 6x6 grid', () => {
  const legacy =
    'character turnaround, on every visible human face only, overlay an ultra-fine orange mesh grid of hair-thin lines covering forehead, cheeks, nose, lips, chin and ears; do not cover hair, neck, body or clothing; the orange grid must stay clearly visible'
  const next = withRealisticCharacterFaceGrid('realistic', legacy)
  assert.match(next, /6x6 white grid across the entire image/)
  assert.doesNotMatch(next, /orange mesh grid/)
  assert.doesNotMatch(next, /every visible human face only/)
})

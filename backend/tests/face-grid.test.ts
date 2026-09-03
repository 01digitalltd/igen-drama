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
    /visually split every facial feature/,
  )
  assert.match(
    withRealisticCharacterFaceGrid('realistic', 'character turnaround'),
    /12px-thick/,
  )
})

test('video prompt asks to remove the full-image white 6x6 grid for realistic dramas', () => {
  const next = withRealisticVideoFaceGridRemoval('realistic', '0-3秒：@小明抬头。')
  assert.match(next, /去掉参考图整张画面上的白色6×6网格/)
  assert.match(next, /把被网格切开的五官重新拼成完整眉眼鼻口耳/)
  assert.match(next, /reassemble split facial features/)
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
  assert.ok(REALISTIC_FACE_GRID_IMAGE_PROMPT.includes('split every facial feature'))
  assert.ok(REALISTIC_FACE_GRID_VIDEO_PROMPT.includes('白色6×6'))
  assert.ok(REALISTIC_FACE_GRID_VIDEO_PROMPT.includes('五官'))
})

test('legacy grid prompts are replaced with a full-image 6x6 grid that splits facial features', () => {
  const faceOnly =
    'character turnaround, on every visible human face only, overlay an ultra-fine orange mesh grid of hair-thin lines covering forehead, cheeks, nose, lips, chin and ears; do not cover hair, neck, body or clothing; the orange grid must stay clearly visible'
  const fromFace = withRealisticCharacterFaceGrid('realistic', faceOnly)
  assert.match(fromFace, /6x6 white grid across the entire image/)
  assert.match(fromFace, /visually split every facial feature/)
  assert.doesNotMatch(fromFace, /orange mesh grid/)
  assert.doesNotMatch(fromFace, /every visible human face only/)

  const sixBySix =
    'character turnaround, overlay a 6x6 white grid across the entire image (pure white #FFFFFF, 100% opacity, 12px-thick lines); six columns by six rows spanning the full frame from edge to edge, covering people, clothing, background and all other content; the white grid must stay fully opaque and clearly visible'
  const fromSix = withRealisticCharacterFaceGrid('realistic', sixBySix)
  assert.match(fromSix, /visually split every facial feature/)
  assert.equal((fromSix.match(/overlay a 6x6 white grid/g) || []).length, 1)

  const nineByNine =
    'character turnaround, overlay a 9x9 white grid across the entire image (pure white #FFFFFF, 100% opacity, 12px-thick lines); nine columns by nine rows spanning the full frame from edge to edge; the grid lines must cut through and visually split every facial feature (eyebrows, eyes, nose, mouth, ears) so no complete feature stays inside a single cell; covering people, clothing, background and all other content; the white grid must stay fully opaque and clearly visible'
  const fromNine = withRealisticCharacterFaceGrid('realistic', nineByNine)
  assert.match(fromNine, /6x6 white grid across the entire image/)
  assert.match(fromNine, /visually split every facial feature/)
  assert.doesNotMatch(fromNine, /9x9/)
})

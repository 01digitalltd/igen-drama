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
    /ultra-fine orange mesh grid/,
  )
})

test('video prompt asks to remove the orange face grid for realistic dramas', () => {
  const next = withRealisticVideoFaceGridRemoval('realistic', '0-3秒：@小明抬头。')
  assert.match(next, /去掉参考图人物脸部的橙色超幼线网格/)
  assert.match(next, /Remove the orange ultra-fine mesh grid/)
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
  assert.ok(REALISTIC_FACE_GRID_IMAGE_PROMPT.includes('orange'))
  assert.ok(REALISTIC_FACE_GRID_VIDEO_PROMPT.includes('橙色'))
})

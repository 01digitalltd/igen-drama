import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyHandheldViewpoint } from '../src/services/handheld-viewpoint.ts'

test('a handheld line becomes the camera angle and hides the camera prop', () => {
  const description = '【鏡頭1】女主角單手手持鏡頭自拍，對著街景介紹。'
  const prompt = '女主角單手手持鏡頭自拍，手裡拿著一台手機對著街景。'
  const next = applyHandheldViewpoint(prompt, description)
  assert.match(next, /看著鏡頭/)
  assert.doesNotMatch(next, /手持鏡頭|拿著一台手機/)
  assert.match(next, /The viewer is the camera/)
  assert.equal(applyHandheldViewpoint(next, description), next)
})

test('an English camera prop is rewritten when the shot is handheld', () => {
  const next = applyHandheldViewpoint(
    '<IMAGE_0> is holding a camera and talking.',
    '她手持鏡頭對著街景說。',
  )
  assert.match(next, /looking into the lens/)
  assert.doesNotMatch(next, /holding a camera/)
})

test('a shot that is not filmed by her keeps a camera prop', () => {
  const prompt = '桌上放著一台相機。'
  assert.equal(applyHandheldViewpoint(prompt, '他坐在桌前看信。'), prompt)
})

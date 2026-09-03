import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendEmptySceneGuard, EMPTY_SCENE_GUARD } from '../src/services/empty-scene-prompt.ts'

test('empty prompt becomes the empty-scene guard', () => {
  assert.equal(appendEmptySceneGuard(''), EMPTY_SCENE_GUARD)
  assert.equal(appendEmptySceneGuard('   '), EMPTY_SCENE_GUARD)
})

test('appends the empty-scene guard when the prompt describes people or props', () => {
  const next = appendEmptySceneGuard('夜晚的便利店，店员站在柜台后，柜台上放着一封信')
  assert.match(next, /^夜晚的便利店/)
  assert.match(next, /没有任何人物/)
  assert.match(next, /空场景建立镜头/)
  assert.match(next, /没有可手持的剧情道具/)
})

test('does not duplicate the guard when the prompt is already an empty plate', () => {
  const already = '固定机位广角镜头，便利店内景，画面中没有任何人物，空场景，电影质感'
  assert.equal(appendEmptySceneGuard(already), already)
})

test('force-append still trails the guard when the prompt mentions people', () => {
  const mixed = '夜晚的便利店，店员站在柜台后，画面中没有任何人物，空场景'
  const next = appendEmptySceneGuard(mixed, true)
  assert.match(next, /店员站在柜台后/)
  assert.ok(next.endsWith(EMPTY_SCENE_GUARD))
  assert.equal(appendEmptySceneGuard(next, true), next)
})

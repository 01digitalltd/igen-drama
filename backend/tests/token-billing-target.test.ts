import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dramaBillingTarget } from '../src/services/token-billing-target.ts'

test('a shot video bills the shot id and the requested seconds', () => {
  const target = dramaBillingTarget({
    id: 9,
    type: 'video',
    storyboardId: 44,
    params: JSON.stringify({ duration: 8.2 }),
  })
  assert.deepEqual(target, { serviceName: 'aiVideo', recordId: 'drama-shot-44', videoSeconds: 9 })
})

test('a shot video without duration uses the same 5 second default as the browser', () => {
  const target = dramaBillingTarget({ id: 9, type: 'video', storyboardId: 44, params: '{}' })
  assert.equal(target?.videoSeconds, 5)
})

test('image record ids follow character, scene, then prop', () => {
  assert.equal(dramaBillingTarget({ id: 1, type: 'image', characterId: 7 })?.recordId, 'drama-character-7')
  assert.equal(dramaBillingTarget({ id: 1, type: 'image', sceneId: 3 })?.recordId, 'drama-scene-3')
  assert.equal(dramaBillingTarget({ id: 1, type: 'image', propId: 2 })?.recordId, 'drama-prop-2')
})

test('a storyboard still is not billed', () => {
  assert.equal(dramaBillingTarget({ id: 1, type: 'image', storyboardId: 5 }), null)
})

test('merge and other task types are not billed', () => {
  assert.equal(dramaBillingTarget({ id: 1, type: 'merge' }), null)
  assert.equal(dramaBillingTarget({ id: 1, type: 'audio' }), null)
})

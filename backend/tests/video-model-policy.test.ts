import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SEEDANCE_BLOCKED_FOR_REALISTIC_MESSAGE,
  assertSeedanceAllowedForStyle,
  isRealisticDramaStyle,
  isSeedanceVideoConfig,
} from '../src/services/video-model-policy.ts'

test('realistic live-action style blocks Seedance video configs', () => {
  assert.equal(isRealisticDramaStyle('realistic'), true)
  assert.equal(isRealisticDramaStyle('3d'), false)
  assert.equal(isSeedanceVideoConfig('volcengine', 'MiniMax-H3'), true)
  assert.equal(isSeedanceVideoConfig('gemini', 'gemini-omni-flash-preview'), false)
  assert.equal(isSeedanceVideoConfig('minimax', 'MiniMax-H3'), false)
  assert.equal(isSeedanceVideoConfig('openai', 'dreamina-seedance-2-0-260128'), true)

  assert.doesNotThrow(() => assertSeedanceAllowedForStyle('3d', 'volcengine', 'doubao-seedance-2-0-fast-260128'))
  assert.doesNotThrow(() => assertSeedanceAllowedForStyle('realistic', 'gemini', 'gemini-omni-flash-preview'))
  assert.throws(
    () => assertSeedanceAllowedForStyle('realistic', 'volcengine', 'doubao-seedance-2-0-fast-260128'),
    (err: Error) => err.message === SEEDANCE_BLOCKED_FOR_REALISTIC_MESSAGE,
  )
})

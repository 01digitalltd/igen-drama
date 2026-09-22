import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MINIMAX_BALANCE_NO_SEEDANCE_MESSAGE,
  MINIMAX_H3_MISSING_MESSAGE,
  SEEDANCE_BLOCKED_FOR_REALISTIC_MESSAGE,
  assertSeedanceAllowedForStyle,
  canFallbackMiniMaxToSeedance,
  expectedVideoProvider,
  isRealisticDramaStyle,
  isSeedanceVideoConfig,
  videoModelFitsProvider,
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

test('MiniMax-H3 must not ride a Gemini video config', () => {
  assert.equal(expectedVideoProvider('MiniMax-H3'), 'minimax')
  assert.equal(expectedVideoProvider('gemini-omni-1.1-flash'), 'gemini')
  assert.equal(videoModelFitsProvider('gemini', 'MiniMax-H3'), false)
  assert.equal(videoModelFitsProvider('minimax', 'MiniMax-H3'), true)
  assert.equal(MINIMAX_H3_MISSING_MESSAGE.includes('MiniMax-H3'), true)
})

test('MiniMax balance errors can fall back to Seedance except realistic dramas', () => {
  assert.equal(canFallbackMiniMaxToSeedance({ provider: 'minimax', style: '3d' }), true)
  assert.equal(canFallbackMiniMaxToSeedance({ provider: 'minimax', style: 'realistic' }), false)
  assert.equal(canFallbackMiniMaxToSeedance({ provider: 'gemini', style: '3d' }), false)
  assert.equal(canFallbackMiniMaxToSeedance({
    provider: 'minimax',
    style: '3d',
    alreadyFallback: true,
  }), false)
  assert.match(MINIMAX_BALANCE_NO_SEEDANCE_MESSAGE, /1008/)
  assert.match(MINIMAX_BALANCE_NO_SEEDANCE_MESSAGE, /Seedance/)
})

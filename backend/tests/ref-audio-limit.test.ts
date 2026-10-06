import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SEEDANCE_R2V_MAX_AUDIO_SECONDS,
  refAudioExceedsLimit,
  refAudioTooLongMessage,
  rewriteSeedanceAudioLimitError,
} from '../src/services/tts/ref-audio-limit.ts'

test('15.2 seconds is allowed and anything longer is not', () => {
  assert.equal(refAudioExceedsLimit(SEEDANCE_R2V_MAX_AUDIO_SECONDS), false)
  assert.equal(refAudioExceedsLimit(15.21), true)
  assert.equal(refAudioExceedsLimit(null), false)
})

test('too-long message names the measured seconds and the cap', () => {
  assert.match(refAudioTooLongMessage(18.36), /18\.4 秒/)
  assert.match(refAudioTooLongMessage(18.36), /15\.2 秒/)
})

test('provider content[n] audio error is rewritten', () => {
  const raw = 'The parameter `content[7]` specified in the request is not valid: the parameter audio duration (seconds) specified in the request must be less than or equal to 15.2 for model dreamina-seedance-2-0 in r2v.'
  const next = rewriteSeedanceAudioLimitError(raw)
  assert.match(next, /15\.2 秒/)
  assert.doesNotMatch(next, /content\[7\]/)
  assert.equal(rewriteSeedanceAudioLimitError('other failure'), 'other failure')
})

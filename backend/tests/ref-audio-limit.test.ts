import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SEEDANCE_R2V_MAX_AUDIO_SECONDS,
  findRefAudioOverflows,
  formatRefAudioSplitError,
  refAudioExceedsLimit,
  refAudioTooLongMessage,
  referenceAudioBudgetLine,
  referenceAudioSpeechBudget,
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

test('grouped narrator lines over 15.2 seconds are rejected together', () => {
  const shortLine = `旁白：${'啊'.repeat(20)}`
  assert.equal(findRefAudioOverflows(shortLine, 'cmn-TW').length, 0)
  const longLine = [`旁白：${'啊'.repeat(30)}`, `旁白：${'啊'.repeat(30)}`].join('\n')
  const overflows = findRefAudioOverflows(longLine, 'cmn-TW')
  assert.equal(overflows.length, 1)
  assert.equal(overflows[0].speaker, '旁白')
  assert.ok(overflows[0].seconds > SEEDANCE_R2V_MAX_AUDIO_SECONDS)
})

test('speech budget matches the 15.2 second pace', () => {
  assert.equal(referenceAudioSpeechBudget('cmn-TW').maxChars, 57)
  assert.equal(referenceAudioSpeechBudget('en-US').maxWords, 36)
  assert.match(referenceAudioBudgetLine('cmn-TW'), /57 个字/)
  assert.match(formatRefAudioSplitError([{ shotNumber: 2, speaker: '旁白', seconds: 18.36 }]), /第 2 镜旁白约 18\.4 秒/)
  assert.match(formatRefAudioSplitError([{ shotNumber: 2, speaker: '旁白', seconds: 18.36 }]), /replace_existing: true/)
})

test('provider content[n] audio error is rewritten', () => {
  const raw = 'The parameter `content[7]` specified in the request is not valid: the parameter audio duration (seconds) specified in the request must be less than or equal to 15.2 for model dreamina-seedance-2-0 in r2v.'
  const next = rewriteSeedanceAudioLimitError(raw)
  assert.match(next, /15\.2 秒/)
  assert.doesNotMatch(next, /content\[7\]/)
  assert.equal(rewriteSeedanceAudioLimitError('other failure'), 'other failure')
})

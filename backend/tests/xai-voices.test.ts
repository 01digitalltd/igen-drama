import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canUseReferenceAudio, extractSpokenLines } from '../src/services/tts/vo-speech.ts'
import { appendXaiVoiceDirective, selectXaiReferenceVoices, xaiVoiceIdForSpeaker } from '../src/services/tts/xai-voices.ts'

test('xAI does not attach MiniMax wavs', () => {
  assert.equal(canUseReferenceAudio('xai', 'grok-imagine-video-1.5'), false)
  assert.equal(canUseReferenceAudio('minimax', 'MiniMax-H3'), true)
})

test('preset voices keep the narrator distinct from a same-gender character', () => {
  assert.equal(xaiVoiceIdForSpeaker('narrator', 'female', 'female'), 'ara')
  assert.equal(xaiVoiceIdForSpeaker('character', 'female', 'female'), 'eve')
  assert.equal(xaiVoiceIdForSpeaker('character', 'male', 'female'), 'rex')
  assert.equal(xaiVoiceIdForSpeaker('narrator', 'male', 'male'), 'rex')
  assert.equal(xaiVoiceIdForSpeaker('character', 'male', 'male'), 'leo')
  assert.equal(xaiVoiceIdForSpeaker('character', 'female', 'male'), 'ara')

  const voices = selectXaiReferenceVoices({
    narratorGender: 'female',
    characters: [{ name: '志遠', appearance: '成年男性' }, { name: '小美', appearance: '年輕女性' }],
    lines: extractSpokenLines('女声旁白：歡迎光臨。\n志遠说：「你好。」\n小美说：「請坐。」'),
  })
  assert.deepEqual(voices.map((voice) => voice.voiceId), ['ara', 'rex', 'eve'])
  const prompt = appendXaiVoiceDirective('志遠说：「你好。」', voices)
  assert.match(prompt, /\[XAI_VOICES:/)
  assert.match(prompt, /ara/)
  assert.equal(appendXaiVoiceDirective(prompt, voices).split('[XAI_VOICES:').length, 2)
})

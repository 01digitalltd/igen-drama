import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  appendVoVoiceDirective,
  narratorInlineLabel,
  normalizeVoVoice,
  rewriteNarratorLabels,
  voVoiceInstruction,
  voVoiceLabel,
} from '../src/services/vo-voice.ts'

test('normalizes narrator voice codes', () => {
  assert.equal(normalizeVoVoice('female'), 'female')
  assert.equal(normalizeVoVoice('male'), 'male')
  assert.equal(normalizeVoVoice('女声'), 'female')
  assert.equal(normalizeVoVoice('男'), 'male')
  assert.equal(normalizeVoVoice(''), 'female')
  assert.equal(voVoiceLabel('male'), '男声')
})

test('rewrites 旁白 to a locked speaker and skips 无旁白', () => {
  const female = rewriteNarratorLabels('0-3秒：旁白：今晚的风很大。无旁白。', 'female')
  assert.match(female, /女声旁白（S1/)
  assert.match(female, /无旁白/)
  assert.doesNotMatch(female, /(?<!女声)旁白：今晚/)
  const swapped = rewriteNarratorLabels('男声旁白：你好', 'female')
  assert.match(swapped, /^女声旁白（S1/)
  const again = rewriteNarratorLabels(female, 'female')
  assert.equal(again, female)
})

test('video prompt instruction pins one narrator timbre', () => {
  const female = voVoiceInstruction('female')
  assert.match(female, /女声/)
  assert.match(female, /S1/)
  assert.match(female, /不要换成男声/)
  assert.match(female, /角色开口仍用该角色自己的声音/)
  assert.equal(narratorInlineLabel('male').startsWith('男声旁白'), true)
})

test('generation appends a narrator tag without duplicating it', () => {
  const first = appendVoVoiceDirective('0-3秒：女声旁白：你好。', 'female')
  assert.match(first, /VO_NARRATOR: female \| speaker=S1/)
  const second = appendVoVoiceDirective(first, 'female')
  assert.equal(second, first)
})

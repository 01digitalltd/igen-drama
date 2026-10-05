import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  appendStoryboardImageTextDirective,
  appendVoLanguageDirective,
  defaultDialogueLanguageFromLocale,
  storyboardImageTextInstruction,
  dialogueLanguageInstruction,
  dialogueLanguageLabel,
  normalizeDialogueLanguage,
} from '../src/services/dialogue-language.ts'

test('normalizes spoken language codes without treating zh-TW as Cantonese', () => {
  assert.equal(normalizeDialogueLanguage('yue-HK'), 'yue-HK')
  assert.equal(normalizeDialogueLanguage('zh-HK'), 'yue-HK')
  assert.equal(normalizeDialogueLanguage('zh-TW'), 'cmn-TW')
  assert.equal(normalizeDialogueLanguage('zh-CN'), 'cmn-CN')
  assert.equal(normalizeDialogueLanguage('en'), 'en-US')
  assert.equal(normalizeDialogueLanguage(''), 'cmn-TW')
})

test('defaults spoken language from UI locale without mapping Traditional Chinese to Cantonese', () => {
  assert.equal(defaultDialogueLanguageFromLocale('zh-TW'), 'cmn-TW')
  assert.equal(defaultDialogueLanguageFromLocale('zh-CN'), 'cmn-CN')
  assert.equal(defaultDialogueLanguageFromLocale('en'), 'en-US')
  assert.equal(defaultDialogueLanguageFromLocale('ja'), 'cmn-TW')
})

test('video prompt instruction asks to rewrite spoken lines only', () => {
  const yue = dialogueLanguageInstruction('yue-HK')
  assert.match(yue, /粵語/)
  assert.match(yue, /yue-HK/)
  assert.match(yue, /角色名說/)
  assert.match(yue, /畫面、運鏡/)
  assert.match(yue, /香港口語書面/)
  assert.equal(dialogueLanguageLabel('en-US'), '英文')
})

test('storyboard still text follows the dialogue language script', () => {
  const yue = storyboardImageTextInstruction('yue-HK')
  assert.match(yue, /繁體中文/)
  assert.match(yue, /不要寫成簡體/)
  const tw = storyboardImageTextInstruction('cmn-TW')
  assert.match(tw, /繁體中文/)
  const cn = storyboardImageTextInstruction('cmn-CN')
  assert.match(cn, /简体中文/)
  assert.doesNotMatch(cn, /繁體中文/)
  const en = storyboardImageTextInstruction('en-US')
  assert.match(en, /English/)
  const first = appendStoryboardImageTextDirective('招牌寫著美肌', 'yue-HK')
  assert.match(first, /STORYBOARD_IMAGE_TEXT/)
  assert.match(first, /繁體中文/)
  const second = appendStoryboardImageTextDirective(first, 'yue-HK')
  assert.equal(second.match(/STORYBOARD_IMAGE_TEXT/g)?.length, 1)
})

test('generation appends a spoken-language tag without duplicating it', () => {
  const first = appendVoLanguageDirective('0-3秒：小明說：「你終於來了。」', 'yue-HK')
  assert.match(first, /VO_DIALOGUE_LANGUAGE: 粵語 \| code=yue-HK/)
  assert.match(first, /NO_ON_SCREEN_TEXT/)
  const second = appendVoLanguageDirective(first, 'yue-HK')
  assert.equal(second.match(/VO_DIALOGUE_LANGUAGE/g)?.length, 1)
  assert.equal(second.match(/NO_ON_SCREEN_TEXT/g)?.length, 1)
})

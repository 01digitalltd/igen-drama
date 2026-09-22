import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rewriteSeedancePromptRefs } from '../src/services/storyboard-prompt.ts'
import {
  resolveLanguageBoost,
  resolveSystemVoiceId,
  emotionFromAtmosphere,
  inferGenderFromText,
} from '../src/services/tts/minimax-voice.ts'
import {
  appendAudioRefDirective,
  canUseReferenceAudio,
  extractSpokenLines,
  pickSpokenLinesForRefAudio,
  shouldSynthesizeAutoTts,
} from '../src/services/tts/vo-speech.ts'

const skillDir = join(dirname(fileURLToPath(import.meta.url)), '../workspace/skills/prompt-generator')

test('Cantonese female maps to GentleLady with Yue boost', () => {
  assert.equal(resolveLanguageBoost('yue-HK'), 'Chinese,Yue')
  assert.equal(resolveSystemVoiceId({ languageCode: 'yue-HK', gender: 'female' }), 'Cantonese_GentleLady')
  assert.equal(resolveSystemVoiceId({ languageCode: 'yue-HK', gender: 'male' }), 'Cantonese_ProfessionalHost（M)')
  assert.equal(resolveSystemVoiceId({ languageCode: 'cmn-TW', gender: 'female' }), 'Chinese (Mandarin)_Warm_Girl')
  assert.equal(resolveSystemVoiceId({ languageCode: 'en-US', gender: 'male' }), 'English_Trustworth_Man')
})

test('extracts narrator and character lines, skips 无旁白', () => {
  const lines = extractSpokenLines(`0-3秒：@咖啡厅，近景。女声旁白：今晚風好大。
3-6秒：切到门口。无旁白。
6-9秒：@小明抬头，小明说：「你终于来了。」
9-12秒：小红说：「我堵车。」男声旁白：故事才剛開始。`)
  assert.deepEqual(lines.map((row) => `${row.kind}:${row.speaker}:${row.text}`), [
    'narrator:旁白:今晚風好大。',
    'character:小明:你终于来了。',
    'narrator:旁白:故事才剛開始。',
    'character:小红:我堵车。',
  ])
})

test('caps reference audio at narrator plus first two characters', () => {
  const picked = pickSpokenLinesForRefAudio(extractSpokenLines(`0-3秒：女声旁白：開始。
3-6秒：甲说：「一。」乙说：「二。」丙说：「三。」`))
  assert.equal(picked.length, 3)
  assert.equal(picked[0].kind, 'narrator')
  assert.deepEqual(picked.slice(1).map((row) => row.speaker), ['甲', '乙'])
})

test('appendAudioRefDirective uses Seedance @Audio 1 with a space', () => {
  const next = appendAudioRefDirective('0-3秒：女声旁白：你好。', [
    { speaker: '旁白', kind: 'narrator', url: 'https://cdn.example.com/a.mp3', voiceId: 'Cantonese_GentleLady', text: '你好' },
    { speaker: '小華', kind: 'character', url: 'https://cdn.example.com/b.mp3', voiceId: 'x', text: '走' },
  ])
  assert.match(next, /@Audio 1 is 旁白 S1/)
  assert.match(next, /@Audio 2 is 小華/)
  assert.doesNotMatch(next, /@Audio1\b/)
  assert.equal(rewriteSeedancePromptRefs(next), next)
})

test('Omni and H3-Max do not attach reference audio', () => {
  assert.equal(canUseReferenceAudio('gemini', 'gemini-omni-1.1-flash'), false)
  assert.equal(canUseReferenceAudio('minimax', 'MiniMax-H3-Max'), false)
  assert.equal(canUseReferenceAudio('minimax', 'MiniMax-H3'), true)
  assert.equal(canUseReferenceAudio('volcengine', 'dreamina-seedance-2-0-260128'), true)
  assert.equal(shouldSynthesizeAutoTts(1), false)
  assert.equal(shouldSynthesizeAutoTts(0), true)
})

test('gender and atmosphere helpers', () => {
  assert.equal(inferGenderFromText('二十五歲女律師，短髮'), 'female')
  assert.equal(inferGenderFromText('年輕男店員'), 'male')
  assert.equal(emotionFromAtmosphere('溫暖平靜'), 'calm')
  assert.equal(emotionFromAtmosphere('氣氛緊張匆忙'), 'fluent')
})

test('video-prompt SKILL forbids @Audio at prompt generation', () => {
  const skill = readFileSync(join(skillDir, 'video-prompt/SKILL.md'), 'utf8')
  assert.match(skill, /禁止写 `@Audio/)
  const omni = readFileSync(join(skillDir, 'video-prompt/omni/SKILL.md'), 'utf8')
  assert.doesNotMatch(omni, /@Audio 1/)
  const still = readFileSync(join(skillDir, 'storyboard-image/SKILL.md'), 'utf8')
  assert.doesNotMatch(still, /@Audio 1/)
})

test('generation attaches TTS only when visual refs exist and provider allows', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const generation = readFileSync(join(root, 'src/services/generation.ts'), 'utf8')
  assert.match(generation, /ensureStoryboardVoAudio/)
  assert.match(generation, /!canUseReferenceAudio\(config\.provider, record\.model\) \|\| !hasVisualRefs/)
  assert.match(generation, /appendAudioRefDirective/)
  const helm = readFileSync(
    join(root, '../../reform-deployment/helm/templates/igen-drama-deployment.yaml'),
    'utf8',
  )
  assert.match(helm, /name: MINIMAX_API_KEY/)
  assert.match(helm, /name: MINIMAX_TTS_MODEL/)
})

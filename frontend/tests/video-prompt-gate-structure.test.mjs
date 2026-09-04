import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const page = read('app/views/drama/episode.vue')
const useAgent = read('app/composables/useAgent.ts')

test('storyboard breakdown auto-starts video prompt batch after refresh', () => {
  assert.match(page, /async \(\) => \{\s*await refresh\(\)\s*await batchVideoPrompts\(\)/)
  assert.match(page, /const allVideoPromptsReady = computed/)
  assert.match(page, /sbs\.value\.every\(hasVideoPrompt\)/)
})

test('video generation is blocked until every shot has a video prompt', () => {
  assert.match(page, /key === 'prod:videos' && !allVideoPromptsReady\.value/)
  assert.match(page, /prodTab\.value === 'storyboard'[\s\S]*!allVideoPromptsReady\.value/)
  assert.match(page, /stageId === 'videos'[\s\S]*!allVideoPromptsReady\.value/)
  assert.match(page, /prodTab === 'storyboard' && !allVideoPromptsReady/)
  assert.match(page, /请先完成全部视频提示词/)
  assert.match(page, /v-else-if="!allVideoPromptsReady"/)
})

test('agent completion callback is awaited so prompt batch sees fresh shots', () => {
  assert.match(useAgent, /await onDone\?\.\(\)/)
})

test('video generation duration follows the prompt timeline, not a separate input', () => {
  assert.match(page, /function parseVideoPromptDurationSeconds/)
  assert.match(page, /duration: shotVideoGenerationDuration\(sb\)/)
  assert.doesNotMatch(page, /v-model\.number="videoDuration"/)
  assert.match(page, /依提示词时间轴/)
})

test('jumping from raw content to AI rewrite starts the rewriter automatically', () => {
  assert.match(page, /scriptStep\.value = 1\s*doRewrite\(\)/)
  assert.match(page, /key === 'script:rewrite' && fromRaw && localRaw\.value\.trim\(\)\) doRewrite\(\)/)
})

test('AI rewrite completion automatically extracts assets', () => {
  assert.match(
    page,
    /await refresh\(\)\s*panel\.value = 'production'\s*prodTab\.value = 'assets'\s*doExtractAll\(\)/,
  )
})

test('video step can change project dialogue language', () => {
  assert.match(page, /dramaDialogueLanguage/)
  assert.match(page, /setDialogueLanguage/)
  assert.match(page, /dialogueLanguageInstruction\(dramaDialogueLanguage\.value\)/)
  assert.match(page, /dialogue_language: next/)
})

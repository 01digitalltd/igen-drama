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

test('manual video prompt button regenerates selected or all shots', () => {
  assert.match(page, /batchVideoPrompts\(selectedSbIds\.length \? selectedSbIds : sbs\.map\(s => s\.id\)\)/)
  assert.match(page, /async function batchVideoPrompts\(storyboardIds\)/)
})

test('changing the video model regenerates every shot prompt', () => {
  assert.match(page, /watch\(videoModel, async \(next, prev\) =>/)
  assert.match(page, /video_config_id: configId/)
  assert.match(page, /batchVideoPrompts\(sbs\.value\.map\(\(sb\) => sb\.id\)\)/)
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
  assert.match(useAgent, /export async function waitAgentJob/)
  assert.match(useAgent, /throw new Error\('Agent 任务超时'\)/)
})

test('single-shot AI generate waits for the prompt_generator job before toasting success', () => {
  assert.match(page, /waitAgentJob\('prompt_generator'/)
  assert.match(page, /视频提示词未写入，请重试/)
})

test('shot video failure stays on the card instead of duplicating the toast', () => {
  assert.match(page, /class="video-task-error"/)
  assert.match(page, /function notifyShotVideoFailure/)
  assert.match(page, /function humanizeVideoTaskError/)
  assert.match(page, /內容安全攔截/)
  const notifyFn = page.match(/function notifyShotVideoFailure[\s\S]*?\n\}/)?.[0] || ''
  assert.match(notifyFn, /failedVideoMessages\.value =/)
  assert.doesNotMatch(notifyFn, /toast\.error/)
  assert.doesNotMatch(page, /toast\.error\(failedVideoMessages\.value\[storyboardId\]\)/)
  assert.doesNotMatch(page, /toast\.error\('镜头生成失败'\)/)
})

test('video generation duration follows the prompt timeline, not a separate input', () => {
  assert.match(page, /function parseVideoPromptDurationSeconds/)
  assert.match(page, /duration: shotVideoGenerationDuration\(sb\)/)
  assert.doesNotMatch(page, /v-model\.number="videoDuration"/)
  assert.match(page, /依提示词时间轴/)
})

test('Omni generation rewrites @name refs to IMAGE_REF tags', () => {
  assert.match(page, /function isOmniVideoModel/)
  assert.match(page, /<IMAGE_REF_\$\{map\[name\] - 1\}>/)
  assert.match(page, /@图片\$\{map\[name\]\}/)
  assert.match(page, /video-prompt\/omni/)
})

test('jumping from raw content to AI rewrite starts the rewriter only when the script is empty', () => {
  assert.match(page, /scriptStep\.value = 1\s*if \(!\(localScript\.value \|\| scriptContent\.value \|\| ''\)\.trim\(\)\) doRewrite\(\)/)
  assert.match(
    page,
    /key === 'script:rewrite' && fromRaw && localRaw\.value\.trim\(\) && !\(localScript\.value \|\| scriptContent\.value \|\| ''\)\.trim\(\)\) doRewrite\(\)/,
  )
})

test('AI rewrite completion goes to assets without extracting', () => {
  const rewriteFn = page.match(/function doRewrite\(\) \{[\s\S]*?\n\}/)?.[0] || ''
  assert.match(rewriteFn, /prodTab\.value = 'assets'/)
  assert.doesNotMatch(rewriteFn, /doExtractAll/)
})

test('video step can change project dialogue language', () => {
  assert.match(page, /dramaDialogueLanguage/)
  assert.match(page, /setDialogueLanguage/)
  assert.match(page, /dialogueLanguageInstruction\(dramaDialogueLanguage\.value\)/)
  assert.match(page, /dialogue_language: next/)
})

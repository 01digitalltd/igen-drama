import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeStoryboardImagePrompt, firstStoryboardBeat, lockStoryboardStillPrompt } from '../src/services/storyboard-prompt.ts'
import { imagePromptFromPayload, looksLikeStillPrompt } from '../src/services/video-prompt-text.ts'

test('firstStoryboardBeat uses the first sub-shot and drops narrator lines', () => {
  const beat = firstStoryboardBeat(
    '【镜头1】办公桌特写，文件散落。旁白：关键字很难找？\n【镜头2】显示器特写。',
  )
  assert.match(beat, /办公桌特写/)
  assert.doesNotMatch(beat, /显示器特写/)
  assert.doesNotMatch(beat, /旁白/)
})

test('composeStoryboardImagePrompt locks named asset refs and refuses a timeline', () => {
  const prompt = composeStoryboardImagePrompt({
    description: '【镜头1】小華把手放在產品包裝上。旁白：一鍵搞定。',
    atmosphere: '希望、專業',
    styleValue: '3d',
    imageRefs: [
      { index: 0, tag: '<IMAGE_REF_0>', kind: 'scene', name: '辦公室', url: 'static/office.png' },
      { index: 1, tag: '<IMAGE_REF_1>', kind: 'character', name: '小華', url: 'static/hua.png' },
    ],
  })
  assert.match(prompt, /单帧分镜静帧/)
  assert.match(prompt, /3D 漫剧/)
  assert.match(prompt, /第一张图是场景空镜（辦公室）/)
  assert.match(prompt, /第二张图是角色设定（小華）/)
  assert.match(prompt, /小華把手放在產品包裝上/)
  assert.doesNotMatch(prompt, /@辦公室/)
  assert.doesNotMatch(prompt, /参考图1/)
  assert.equal(looksLikeStillPrompt(prompt), true)
})

test('lockStoryboardStillPrompt numbers uploaded character stills for image-to-image', () => {
  const refs = [
    { index: 0, tag: '<IMAGE_REF_0>', kind: 'character' as const, name: '小華', url: 'static/hua.png' },
  ]
  const locked = lockStoryboardStillPrompt('单帧分镜静帧，小華坐在办公桌前。', refs)
  assert.match(locked, /第一张图是角色设定（小華）/)
  assert.match(locked, /必须用这张图里的同一张脸/)
  assert.match(locked, /单帧分镜静帧，小華坐在办公桌前。/)
  assert.equal(lockStoryboardStillPrompt('第一张图已经写过', refs), '第一张图已经写过')
})

test('looksLikeStillPrompt rejects video timelines', () => {
  assert.equal(looksLikeStillPrompt('短'), false)
  assert.equal(looksLikeStillPrompt('0-3秒：@小華抬头。'), false)
  assert.equal(looksLikeStillPrompt('单帧分镜静帧，小華坐在办公桌前。'), true)
})

test('imagePromptFromPayload reads image_prompt without stealing video_prompt', () => {
  assert.equal(
    imagePromptFromPayload({ video_prompt: '0-3秒：抬头', image_prompt: '  单帧：抬头  ' }),
    '单帧：抬头',
  )
  assert.equal(imagePromptFromPayload({ video_prompt: '0-3秒：抬头' }), '')
})

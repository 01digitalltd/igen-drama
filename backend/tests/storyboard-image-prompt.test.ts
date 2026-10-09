import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeStoryboardImagePrompt, firstStoryboardBeat, formatOpeningFrameChoice, lockStoryboardStillPrompt, openingFrameChoiceFromPayload, openingFrameRefs, parseOpeningFrameChoice, pickPreviousStoryboardStill, shotContinuityCue } from '../src/services/storyboard-prompt.ts'

test('shot continuity cue uses the first beat and the written ending', () => {
  const cue = shotContinuityCue(
    '【镜头1】她推开办公室门。\n【镜头2】她停在桌前，手还搭在门把上。',
    '手搭在门把上，看向桌面。',
  )
  assert.match(cue.opening, /推开办公室门/)
  assert.equal(cue.ending, '手搭在门把上，看向桌面。')
})

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
  assert.match(prompt, /第 0 帧/)
  assert.match(prompt, /同一部短片/)
  assert.match(prompt, /3D Chibi/)
  assert.match(prompt, /头大身小/)
  assert.match(prompt, /第一张图是场景空镜（辦公室）/)
  assert.match(prompt, /第二张图是角色设定（小華）/)
  assert.match(prompt, /小華把手放在產品包裝上/)
  assert.doesNotMatch(prompt, /@辦公室/)
  assert.doesNotMatch(prompt, /参考图1/)
})

test('lockStoryboardStillPrompt numbers uploaded character stills for image-to-image', () => {
  const refs = [
    { index: 0, tag: '<IMAGE_REF_0>', kind: 'character' as const, name: '小華', url: 'static/hua.png' },
  ]
  const locked = lockStoryboardStillPrompt('单帧分镜静帧，小華坐在办公桌前。', refs)
  assert.match(locked, /同一部短片/)
  assert.match(locked, /第一张图是角色设定（小華）/)
  assert.match(locked, /必须用这张图里的同一张脸/)
  assert.match(locked, /单帧分镜静帧，小華坐在办公桌前。/)
  const alreadyNumbered = lockStoryboardStillPrompt('第一张图已经写过', refs)
  assert.match(alreadyNumbered, /同一部短片/)
  assert.match(alreadyNumbered, /第一张图已经写过/)
})

test('continuity still caption asks Gemini to stay in the same short film', () => {
  const prompt = composeStoryboardImagePrompt({
    description: '【镜头1】小華转身。',
    imageRefs: [
      { index: 0, tag: '<IMAGE_REF_0>', kind: 'character', name: '小華', url: 'static/hua.png' },
      { index: 1, tag: '<IMAGE_REF_1>', kind: 'continuity', name: '分镜1', url: 'static/shot1.png' },
    ],
  })
  assert.match(prompt, /同一部短片/)
  assert.match(prompt, /第二张图是本片已生成的分镜静帧（分镜1）/)
})

test('opening frame keeps shot 1 and drops later shots, including traditional markers', () => {
  const prompt = composeStoryboardImagePrompt({
    description: '【鏡頭1】她在餐廳門口看著鏡頭，身後是街景。\n【鏡頭2】廚房鐵鍋翻炒。\n【鏡頭3】冰檸檬茶特寫。',
  })
  assert.match(prompt, /第 0 帧/)
  assert.match(prompt, /街景/)
  assert.doesNotMatch(prompt, /翻炒/)
  assert.doesNotMatch(prompt, /檸檬茶/)
})

test('opening frame keeps the host and drops a later kitchen, chef, and dish', () => {
  const description = [
    '【鏡頭1】女主角手持鏡頭，興奮地對著香港熱鬧的街頭和一家老字號餐廳的門面，這部短影片將展開一場美食體驗。女主角：（對鏡頭，興奮）介紹自己從小吃的老字號！慶幸今天不用排隊！',
    '【鏡頭2】鏡頭切換到大牌檔的開放式廚房。一位師傅正熟練地在大火上猛烈翻炒著乾炒牛河，鍋氣十足，熱氣騰騰。',
    '【鏡頭3】師傅將炒好的乾炒牛河俐落地裝盤，色澤誘人。',
  ].join('\n')
  const refs = [
    { index: 0, tag: '<IMAGE_REF_0>', kind: 'scene' as const, name: '大牌檔開放式廚房', url: 'static/kitchen.png' },
    { index: 1, tag: '<IMAGE_REF_1>', kind: 'character' as const, name: '阿儀', aliases: ['女主角'], url: 'static/host.png' },
    { index: 2, tag: '<IMAGE_REF_2>', kind: 'character' as const, name: '陳師傅', url: 'static/chef.png' },
    { index: 3, tag: '<IMAGE_REF_3>', kind: 'prop' as const, name: '乾炒牛河', url: 'static/noodles.png' },
  ]
  const picked = openingFrameRefs(description, refs)
  assert.deepEqual(picked.map((ref) => ref.name), ['阿儀'])
  const prompt = composeStoryboardImagePrompt({ description, imageRefs: refs })
  assert.match(prompt, /角色设定（阿儀）/)
  assert.match(prompt, /街/)
  assert.match(prompt, /門面/)
  assert.doesNotMatch(prompt, /開放式廚房/)
  assert.doesNotMatch(prompt, /陳師傅/)
  assert.doesNotMatch(prompt, /乾炒牛河/)
  assert.doesNotMatch(prompt, /kitchen/)
})

test('the skill choice decides whether the bound scene is shot 1 space', () => {
  const description = '【鏡頭1】她站在老字號餐廳的門面外，身後是街頭。'
  const refs = [
    { index: 0, tag: '<IMAGE_REF_0>', kind: 'scene' as const, name: '老字號餐廳', url: 'static/hall.png' },
  ]
  const outside = composeStoryboardImagePrompt({
    description,
    imageRefs: refs,
    openingFrame: { useScene: false, names: [] },
  })
  assert.doesNotMatch(outside, /场景空镜（老字號餐廳）/)
  assert.match(outside, /門面/)

  const inside = composeStoryboardImagePrompt({
    description: '【鏡頭1】她坐在老字號餐廳裡。',
    imageRefs: refs,
    openingFrame: { useScene: true, names: [] },
  })
  assert.match(inside, /场景空镜（老字號餐廳）/)
})

test('opening frame choice round-trips through the saved marker', () => {
  const choice = openingFrameChoiceFromPayload({
    opening_frame: { use_scene: false, names: ['阿儀'] },
  })
  assert.deepEqual(choice, { useScene: false, names: ['阿儀'] })
  assert.deepEqual(parseOpeningFrameChoice(formatOpeningFrameChoice(choice!)), choice)
})

test('handheld viewpoint on the still follows shot 1 only', () => {
  const talking = composeStoryboardImagePrompt({
    description: '【鏡頭1】單手手持鏡頭自拍，身後是街景。\n【鏡頭2】廚房翻炒。',
  })
  assert.match(talking, /\[CAMERA:/)
  assert.doesNotMatch(talking, /翻炒/)

  const cutaway = composeStoryboardImagePrompt({
    description: '【鏡頭1】鐵鍋裡的麵條特寫。\n【鏡頭2】她手持鏡頭說話。',
  })
  assert.doesNotMatch(cutaway, /\[CAMERA:/)
  assert.match(cutaway, /麵條/)
  assert.doesNotMatch(cutaway, /手持鏡頭/)
})

test('a role that names someone else does not enter shot 1 frame 0', () => {
  const description = '【鏡頭1】美玲坐在梳妝台前塗抹護膚品。\n【鏡頭2】志明和小寶走進來。'
  const refs = [
    { index: 0, tag: '<IMAGE_REF_0>', kind: 'scene' as const, name: '客廳', url: 'static/room.png' },
    { index: 1, tag: '<IMAGE_REF_1>', kind: 'character' as const, name: '美玲', aliases: ['女主角'], url: 'static/mei.png' },
    { index: 2, tag: '<IMAGE_REF_2>', kind: 'character' as const, name: '志明', aliases: ['美玲的老公'], url: 'static/zhi.png' },
    { index: 3, tag: '<IMAGE_REF_3>', kind: 'character' as const, name: '小寶', aliases: ['美玲與志明的孩子'], url: 'static/bao.png' },
    { index: 4, tag: '<IMAGE_REF_4>', kind: 'character' as const, name: '美容師', aliases: ['美容院員工'], url: 'static/staff.png' },
    { index: 5, tag: '<IMAGE_REF_5>', kind: 'prop' as const, name: '朗然美肌護膚品', url: 'static/jar.png' },
    { index: 6, tag: '<IMAGE_REF_6>', kind: 'continuity' as const, name: '分鏡1', url: 'static/prev.png' },
  ]
  const picked = openingFrameRefs(description, refs, {
    useScene: true,
    names: ['美玲', '朗然美肌護膚品', '美容院'],
  })
  assert.deepEqual(picked.map((ref) => ref.name), ['客廳', '美玲', '朗然美肌護膚品'])
  const prompt = composeStoryboardImagePrompt({
    description,
    atmosphere: '溫馨、柔和，隨後轉為感動。',
    imageRefs: refs,
    openingFrame: { useScene: true, names: ['美玲', '朗然美肌護膚品'] },
  })
  assert.match(prompt, /角色设定（美玲）/)
  assert.match(prompt, /朗然美肌護膚品/)
  assert.match(prompt, /只画第一眼/)
  assert.match(prompt, /溫馨、柔和/)
  assert.doesNotMatch(prompt, /志明/)
  assert.doesNotMatch(prompt, /小寶/)
  assert.doesNotMatch(prompt, /美容師/)
  assert.doesNotMatch(prompt, /分鏡1/)
  assert.doesNotMatch(prompt, /感動/)
})

test('pickPreviousStoryboardStill prefers the nearest earlier composed still', () => {
  const current = { id: 3, storyboardNumber: 3, composedImage: null, firstFrameImage: null }
  const pick = pickPreviousStoryboardStill(current, [
    { id: 1, storyboardNumber: 1, composedImage: 'static/1.png', firstFrameImage: null },
    { id: 2, storyboardNumber: 2, composedImage: 'static/2.png', firstFrameImage: null },
    current,
    { id: 4, storyboardNumber: 4, composedImage: 'static/4.png', firstFrameImage: null },
  ])
  assert.equal(pick?.id, 2)
  assert.equal(pickPreviousStoryboardStill(current, [current]), null)
})

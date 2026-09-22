import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  appendAssetRestyleDirective,
  appendImageStyleDirective,
  appendVisualStyleDirective,
  imageStyleLock,
  stripImageStyleWrappers,
  videoVisualStyleText,
  visualStyleInstruction,
} from '../src/services/style-preset.ts'

test('3D video style forbids live-action even if the image preset says semi-realistic', () => {
  const text = videoVisualStyleText(
    '3d',
    '3D chibi CG animation style, game-engine quality render, super-deformed characters',
  )
  assert.match(text, /3D chibi CG animated/)
  assert.match(text, /Not live-action camera footage/)
  assert.match(text, /restyle rooms, people and packaging/)
  assert.doesNotMatch(text, /skin pores/)
  assert.doesNotMatch(text, /real human/)
})

test('video prompt instruction pins 3D and skips empty style', () => {
  const threeD = visualStyleInstruction('3d')
  assert.match(threeD, /3D Chibi/)
  assert.match(threeD, /头身比约 1:2/)
  assert.match(threeD, /场景空镜必须是同款圆润卡通三维空间/)
  assert.match(threeD, /道具单品必须是同款三维玩具产品/)
  assert.match(threeD, /禁止写成真人实拍/)
  assert.match(threeD, /转成 3D Chibi 盲盒风/)
  assert.equal(visualStyleInstruction(''), '')
  assert.match(visualStyleInstruction('realistic'), /写实真人/)
})

test('generation prepends a visual-style tag without duplicating it', () => {
  const first = appendVisualStyleDirective('0-3秒：@小明转身。', '3d', '3D CG animation style')
  assert.match(first, /^\[VISUAL_STYLE: 3d \|/)
  assert.match(first, /Not live-action camera footage/)
  assert.match(first, /0-3秒：@小明转身。/)
  assert.match(first, /\[STYLE_LOCK\]/)
  assert.match(first, /Restyle every reference still/)
  const second = appendVisualStyleDirective(first, '3d', '3D CG animation style')
  assert.equal(second, first)
})

test('realistic style does not add a restyle lock', () => {
  const text = appendVisualStyleDirective('0-3秒：@小明转身。', 'realistic', 'photorealistic live-action')
  assert.match(text, /\[VISUAL_STYLE: realistic/)
  assert.doesNotMatch(text, /\[STYLE_LOCK\]/)
})

test('uploaded asset stills get a analyze-then-restyle prompt', () => {
  const first = appendAssetRestyleDirective('半身角色海报构图', 'character', '3d')
  assert.match(first, /【转风格｜必须遵守】/)
  assert.match(first, /用户提供的角色原图/)
  assert.match(first, /分析外形/)
  assert.match(first, /3D Chibi/)
  assert.match(first, /头身比约 1:2/)
  assert.match(first, /半身角色海报构图/)
  assert.equal(appendAssetRestyleDirective(first, 'character', '3d'), first)
  assert.match(appendAssetRestyleDirective(first, 'character', 'anime'), /日漫赛璐璐/)
})

test('image generation restyles existing asset stills and skips brand logos', () => {
  const src = readFileSync(new URL('../src/services/generation.ts', import.meta.url), 'utf8')
  assert.match(src, /params = await attachAssetStillForRestyle\(params\)/)
  assert.match(src, /if \(isBrandLogoProp\(row\)\) return params/)
  assert.match(src, /labeledAssetReferenceImages/)
  assert.match(src, /先分析外形，再转成项目画风/)
  assert.match(src, /appendImageStyleDirective\(params\.prompt, visual\.value, visual\.prompt, kind\)/)
  assert.match(src, /项目画风的空场景/)
  assert.match(src, /项目画风的单品/)
})

test('3D Chibi image prompts lock vinyl chibi over cinematic live-action wording', () => {
  const drafted = '角色设定参考图，左侧为正脸特写，纯白背景，柔和均匀的光线，电影质感'
  const sent = appendImageStyleDirective(drafted, '3d', 'Unreal Engine / game-engine cinematic render, cinematic lighting', 'character')
  assert.match(sent, /^\[VISUAL_STYLE: 3d \|/)
  assert.match(sent, /【画面风格｜必须遵守】/)
  assert.match(sent, /头身比约 1:2/)
  assert.match(sent, /盲盒风/)
  assert.match(sent, /Pop Mart/)
  assert.match(sent, /vinyl-figure/)
  assert.match(sent, /3D Chibi/)
  assert.match(sent, /禁止真人照片/)
  assert.match(sent, /均匀三维棚灯/)
  assert.match(sent, /三维卡通光/)
  assert.match(sent, /禁止电影质感/)
  assert.doesNotMatch(stripImageStyleWrappers(sent), /电影质感/)
  assert.doesNotMatch(sent, /cinematic lighting/)
  assert.doesNotMatch(sent, /Unreal Engine game-cinematic/)
  assert.match(sent, /Not Unreal cinematic photoreal/)
  assert.match(imageStyleLock('3d', 'character'), /头大身小/)
  assert.equal(appendImageStyleDirective(sent, '3d', '3D chibi CG animation style', 'character'), sent)
})

test('3D Chibi scene and prop prompts lock CG rooms and products, not live-action photos', () => {
  const scene = appendImageStyleDirective('固定机位广角镜头，办公室空场景，电影质感', '3d', '3D chibi CG animation style', 'scene')
  assert.match(scene, /空场景参考图/)
  assert.match(scene, /三维空间/)
  assert.match(scene, /禁止真人实拍办公室/)
  assert.doesNotMatch(imageStyleLock('3d', 'scene'), /头大身小/)
  const prop = appendImageStyleDirective('单品产品图，标准产品摄影视角', '3d', '3D chibi CG animation style', 'prop')
  assert.match(prop, /白底单品图/)
  assert.match(prop, /盲盒风三维产品/)
  assert.match(prop, /禁止真人产品摄影/)
  const restyleScene = appendAssetRestyleDirective('办公室实拍', 'scene', '3d')
  assert.match(restyleScene, /场景原图/)
  assert.match(restyleScene, /空间布局/)
  const restyleProp = appendAssetRestyleDirective('护手霜包装', 'prop', '3d')
  assert.match(restyleProp, /道具原图/)
  assert.match(restyleProp, /包装与 Logo/)
})

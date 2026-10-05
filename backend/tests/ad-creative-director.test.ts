import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8')

const LIBRARY = 'workspace/skills/ad-creative-director/references/creative-plot-library.md'
const DEVICE_SHADOW = /手法词汇|情节库|問題怪獸|怪兽|分身|控制室|主导手法|内部选 1 个主机制/

test('ad-creative-director keeps the user story spine without a plot library', () => {
  const skill = read('workspace/skills/ad-creative-director/SKILL.md')
  assert.match(skill, /name: ad-creative-director/)
  assert.match(skill, /故事主干/)
  assert.match(skill, /五拍节奏/)
  assert.match(skill, /用户写下的事件顺序必须保留/)
  assert.match(skill, /不要写死粤语/)
  assert.match(skill, /prompt_generator/)
  assert.match(skill, /## S编号/)
  assert.doesNotMatch(skill, DEVICE_SHADOW)
  assert.equal(existsSync(path.join(root, LIBRARY)), false)
})

test('ad rewrite instruction keeps the user story spine without a plot library', () => {
  const src = read('src/agents/tools/script-tools.ts')
  assert.match(src, /故事主干/)
  assert.match(src, /Hook（约前 3 秒）/)
  assert.match(src, /markdown 分镜表/)
  assert.match(src, /## S编号/)
  assert.match(src, /不要写死粤语/)
  assert.match(src, /pack_hero/)
  assert.match(src, /用户写下的事件顺序必须保留/)
  assert.doesNotMatch(src, DEVICE_SHADOW)
})

test('script-rewriter documents the ad story-spine exception without a plot library', () => {
  const skill = read('workspace/skills/script-rewriter/SKILL.md')
  assert.match(skill, /广告改写例外/)
  assert.match(skill, /brief/)
  assert.match(skill, /五拍/)
  assert.match(skill, /用户写下的事件顺序必须保留/)
  assert.doesNotMatch(skill, DEVICE_SHADOW)
})

test('product form skills cannot replace a written event order', () => {
  for (const rel of [
    'workspace/skills/ad-form-product/SKILL.md',
    'workspace/skills/ad-product-sell/SKILL.md',
  ]) {
    const skill = read(rel)
    assert.match(skill, /用户写下的事件顺序必须保留/)
    assert.doesNotMatch(skill, DEVICE_SHADOW)
  }
})

test('storyboard keeps every script event when the shot budget is tight', () => {
  const skill = read('workspace/skills/storyboard-breaker/SKILL.md')
  const prompt = read('src/agents/index.ts')
  assert.match(skill, /不得删掉剧本里的事件/)
  assert.match(prompt, /不得删掉剧本里的事件/)
})

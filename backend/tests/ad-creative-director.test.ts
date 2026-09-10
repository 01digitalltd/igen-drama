import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8')

const PLOT_TITLES = [
  '問題怪獸',
  '倒轉結局',
  '最後三秒拯救',
  '傳統方法與專業方法賽跑',
  '未來的自己突然出現',
  '微型團隊進入房屋',
  '多重分身失控',
  '身體控制室',
  '神秘盒子',
  '骨牌效應',
  '兩個平行世界',
  '身體不適上法庭',
  '恐怖片誤導',
  '選擇門',
  '無限循環工作日',
]

test('ad-creative-director skill and plot library exist with 15 mechanisms', () => {
  const skill = read('workspace/skills/ad-creative-director/SKILL.md')
  assert.match(skill, /name: ad-creative-director/)
  assert.match(skill, /不要写死粤语/)
  assert.match(skill, /prompt_generator/)
  assert.match(skill, /## S编号/)

  const library = read('workspace/skills/ad-creative-director/references/creative-plot-library.md')
  for (const title of PLOT_TITLES) {
    assert.ok(library.includes(title), `missing plot ${title}`)
  }
  assert.match(library, /中段鋪陳衝突/)
  assert.match(library, /轉折（專業\/產品登場）/)
})

test('ad rewrite instruction internally selects plots and forbids tables', () => {
  const src = read('src/agents/tools/script-tools.ts')
  assert.match(src, /内部选 1 个主机制/)
  assert.match(src, /markdown 分镜表/)
  assert.match(src, /## S编号/)
  assert.match(src, /不要写死粤语/)
  assert.match(src, /pack_hero/)
})

test('script-rewriter documents the ad plot-reinvention exception', () => {
  const skill = read('workspace/skills/script-rewriter/SKILL.md')
  assert.match(skill, /广告改写例外/)
  assert.match(skill, /brief/)
})

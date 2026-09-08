import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('prompt_generator video prompt format uses @name references instead of XML tags', () => {
  const agents = read('src/agents/index.ts')
  const skill = read('workspace/skills/prompt-generator/video-prompt/SKILL.md')
  const omni = read('workspace/skills/prompt-generator/video-prompt/omni/SKILL.md')

  // 场景/角色用 @名字 引用（名字必须与场景/角色列表完全一致）
  assert.match(agents, /@场景名/)
  assert.match(agents, /@角色名/)
  assert.match(agents, /@志远 → @图片1志远/)
  assert.match(agents, /prompt_skill/)
  assert.match(agents, /video-prompt\/omni/)
  assert.doesNotMatch(agents, /<location>/)
  assert.doesNotMatch(agents, /<role>/)

  // Seedance SKILL.md
  assert.match(skill, /@场景名/)
  assert.match(skill, /@角色名/)
  assert.match(skill, /@小明.*@图片1小明/)
  assert.match(skill, /prompt_skill/)
  assert.match(skill, /video-prompt\/omni/)
  assert.doesNotMatch(skill, /<location>/)
  assert.doesNotMatch(skill, /<role>/)

  // Omni SKILL.md：落库仍用 @名字，时间轴用 [0-3s]，必写音频
  assert.match(omni, /@场景名/)
  assert.match(omni, /@角色名/)
  assert.match(omni, /\[0-3s\]/)
  assert.match(omni, /无对白/)
  assert.match(omni, /<IMAGE_REF_N>/)
  assert.doesNotMatch(omni, /<location>/)
  assert.doesNotMatch(omni, /<role>/)
  assert.match(omni, /不要写成 Seedance/)
})

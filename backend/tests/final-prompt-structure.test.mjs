import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('characters and scenes tables store the agent-written final prompt', () => {
  const schema = read('src/db/schema.ts')

  assert.match(schema, /export type CharacterRow = \{[\s\S]*?finalPrompt:/)
  assert.match(schema, /export type SceneRow = \{[\s\S]*?finalPrompt:/)
  assert.match(schema, /export const characters = defineTable<CharacterRow>\('characters'/)
  assert.match(schema, /export const scenes = defineTable<SceneRow>\('scenes'/)
})

test('grid prompt agent tools save agent-written final prompts with style injection', () => {
  const tools = read('src/agents/tools/image-prompt-tools.ts')

  assert.match(tools, /save_character_final_prompt/)
  assert.match(tools, /save_scene_final_prompt/)
  // 保存时注入项目视觉风格并落库
  assert.match(tools, /getDramaStylePrompt/)
  assert.match(tools, /set\(\{ finalPrompt, updatedAt: now\(\) \}\)/)
  // 提示词由 Agent 创作，不再由工具机械拼接
  assert.doesNotMatch(tools, /generate_character_prompt/)
  assert.doesNotMatch(tools, /generate_scene_prompt/)
})

test('prompt agent instructions reference per-asset skills; skill files define the specs', () => {
  const agents = read('src/agents/index.ts')
  const charSkill = read('workspace/skills/prompt-generator/character-prompt/SKILL.md')
  const sceneSkill = read('workspace/skills/prompt-generator/scene-prompt/SKILL.md')

  assert.match(agents, /角色三视图/)
  assert.match(agents, /场景固定视角/)
  assert.match(agents, /道具白底单品/)
  assert.match(agents, /save_character_final_prompt/)
  assert.match(agents, /save_scene_final_prompt/)
  // 角色三视图 / 场景固定视角的必备要素由技能文件承载（纯中文输出）
  assert.match(charSkill, /正脸特写/)
  assert.match(charSkill, /正面、90 度侧面、背面/)
  assert.match(charSkill, /三个视图的脸、发型和服装完全一致/)
  assert.doesNotMatch(charSkill, /白色 6×6 网格/)
  assert.doesNotMatch(charSkill, /五官分拆/)
  assert.match(charSkill, /纯中文/)
  assert.match(sceneSkill, /固定机位广角镜头/)
  assert.match(sceneSkill, /前景（\[前景元素\]）、中景（\[中景主体空间\]）、后景（\[后景纵深\]）/)
  assert.match(sceneSkill, /出入口/)
  assert.match(sceneSkill, /纯中文/)
  const videoSkill = read('workspace/skills/prompt-generator/video-prompt/SKILL.md')
  const finalPrompt = read('src/services/final-prompt.ts')
  assert.doesNotMatch(agents, /白色6×6网格|白色 6×6 网格/)
  assert.doesNotMatch(videoSkill, /6×6 网格/)
  assert.doesNotMatch(finalPrompt, /6×6 网格/)
})

test('image generation prefers the stored final prompt with agent generation and legacy fallback', () => {
  const service = read('src/services/final-prompt.ts')
  const characters = read('src/routes/characters.ts')
  const scenes = read('src/routes/scenes.ts')
  const props = read('src/routes/props.ts')

  assert.match(service, /export async function ensureCharacterFinalPrompt/)
  assert.match(service, /export async function ensureSceneFinalPrompt/)
  assert.match(service, /getAgent\('prompt_generator'/)
  assert.match(service, /toolChoice: 'none'/)
  assert.match(service, /structuredOutput/)
  assert.match(service, /persistCharacterFinalPrompt/)
  assert.match(service, /persistSceneFinalPrompt/)
  // 已有最终提示词直接复用（force 时忽略强制重新生成）
  assert.match(service, /if \(char\.finalPrompt && !force\) return char\.finalPrompt/)
  assert.match(service, /if \(scene\.finalPrompt && !force\) return scene\.finalPrompt/)
  assert.match(service, /force = false/)

  // generate-image enqueues immediately; prompt agent is generate-prompt only
  const imageRoute = characters.slice(characters.indexOf("generate-image"))
  const imageEnd = imageRoute.indexOf("generate-prompt")
  assert.match(imageRoute.slice(0, imageEnd), /char\.finalPrompt \|\| characterImagePrompt/)
  assert.doesNotMatch(imageRoute.slice(0, imageEnd), /ensureCharacterFinalPrompt/)
  assert.match(scenes, /scene\.finalPrompt \|\|/)
  assert.match(props, /prop\.finalPrompt \|\| propImagePrompt/)

  // generate-prompt still runs the prompt agent
  assert.match(characters, /ensureCharacterFinalPrompt\(char, ep\.id, /)
  assert.match(characters, /text_model/)
  assert.match(characters, /finalPrompt \|\| characterImagePrompt\(char, stylePrompt\)/)
  assert.match(scenes, /ensureSceneFinalPrompt\(scene, ep\.id, /)
  assert.match(characters, /updates\.finalPrompt = body\.final_prompt \|\| null/)
  assert.match(scenes, /updates\.finalPrompt = body\.final_prompt \|\| null/)
})

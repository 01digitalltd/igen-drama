import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('video prompt batch service runs per-shot async agent loop', () => {
  const svc = read('src/services/video-prompts.ts')

  // 默认只处理缺少 video_prompt 的分镜；指定 storyboardIds 时只处理所选（已有提示词也重新生成）
  assert.match(svc, /filter\(sb => !\(sb\.videoPrompt \|\| ''\)\.trim\(\)\)/)
  assert.match(svc, /storyboardIds\?\.length|selectedIds\.length/)
  assert.match(svc, /selectedIds\.includes\(Number\(sb\.id\)\)/)
  // 运行中不重复启动
  assert.match(svc, /status === 'running'\) return \{ started: false, total: -1 \}/)
  // 逐个分镜调用 prompt_generator，以落库结果判定成败
  assert.match(svc, /mastra\.getAgent\('prompt_generator'\)/)
  assert.match(svc, /read_storyboard_context/)
  assert.match(svc, /update_storyboard/)
  assert.match(svc, /fresh\?\.videoPrompt/)
  assert.match(svc, /VIDEO_PROMPT_ATTEMPTS/)
  assert.match(svc, /batch-shot-retry/)
  assert.match(svc, /looksLikeVideoPrompt/)
  assert.match(svc, /from '\.\/video-prompt-text\.js'/)
  assert.match(svc, /persistShotVideoPrompt/)
  assert.match(svc, /mustRewrite/)
  assert.match(svc, /task\.failed > 0 && task\.completed === 0/)
  assert.match(svc, /视频提示词仍按 video-prompt/)
  // 进度跟踪与文本模型覆盖
  assert.match(svc, /current_storyboard_id/)
  assert.match(svc, /modelOverride: opts\.model/)
  assert.match(svc, /dialogueLanguageInstruction\(spoken\)/)
  assert.match(svc, /getDramaDialogueLanguage\(dramaId\)/)
  assert.match(svc, /prompt_skill/)
  assert.match(svc, /video-prompt\/omni/)
  assert.match(svc, /<IMAGE_REF_N>/)
  assert.match(svc, /image_refs/)
})

test('storyboard context injects video_generation clip bounds', () => {
  const tools = read('src/agents/tools/storyboard-tools.ts')
  assert.match(tools, /video_generation/)
  assert.match(tools, /clampShotDurationForModel/)
  assert.match(tools, /duration_warnings/)
  assert.match(tools, /image_refs/)
  assert.match(tools, /buildShotImageRefs/)
  assert.match(tools, /max_total_seconds/)
  assert.match(tools, /save-over-budget/)
  assert.match(tools, /fitShotDurationsToBudget/)
  assert.match(tools, /acceptShotsWithinCount/)
  assert.match(tools, /storyboard_id: z\.coerce\.number\(\)/)
  assert.match(tools, /touchesBindings/)
})

test('episodes route exposes video prompt batch endpoints', () => {
  const route = read('src/routes/episodes.ts')

  assert.match(route, /app\.post\('\/:id\/generate-video-prompts'/)
  assert.match(route, /app\.get\('\/:id\/video-prompts-status'/)
  assert.match(route, /startVideoPromptBatch\(\s*ep\.id,\s*ep\.dramaId/)
  assert.match(route, /body\.storyboard_ids/)
  assert.match(route, /already_running/)
})

/**
 * Scene stills are empty establishing plates: architecture + set dressing only.
 * Character/prop assets are generated separately and composited in video.
 * Persist uses the idempotent form; image generation always trails the guard
 * so leftover people/props in older stored prompts do not win.
 */
export const EMPTY_SCENE_GUARD =
  '画面中没有任何人物，没有角色背影、剪影或照片里的人，没有可手持的剧情道具，空场景建立镜头'

export function appendEmptySceneGuard(prompt: string, force = false): string {
  const text = String(prompt || '').trim().replace(/[，,]\s*$/, '')
  if (!text) return EMPTY_SCENE_GUARD
  if (text.endsWith(EMPTY_SCENE_GUARD)) return text
  if (!force && /没有任何人物/.test(text) && /空场景/.test(text)) return text
  return `${text}，${EMPTY_SCENE_GUARD}`
}

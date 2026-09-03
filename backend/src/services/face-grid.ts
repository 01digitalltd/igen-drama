/** Live-action character face-grid: stills add it so Seedance does not treat the photo as a real person; video prompts ask to remove it. */

export const REALISTIC_STYLE_VALUE = 'realistic'

export const REALISTIC_FACE_GRID_IMAGE_PROMPT =
  'on every visible human face only, overlay an ultra-fine orange mesh grid of hair-thin lines covering forehead, cheeks, nose, lips, chin and ears; do not cover hair, neck, body or clothing; the orange grid must stay clearly visible'

export const REALISTIC_FACE_GRID_VIDEO_PROMPT =
  '去掉参考图人物脸部的橙色超幼线网格，还原自然皮肤与五官，画面中不得残留网格、格子或橙色线。Remove the orange ultra-fine mesh grid from all faces; restore natural photorealistic skin with no lattice overlay.'

export function isRealisticStyle(value?: string | null) {
  return String(value || '').trim().toLowerCase() === REALISTIC_STYLE_VALUE
}

export function withRealisticCharacterFaceGrid(styleValue: string | null | undefined, prompt: string) {
  const base = String(prompt || '').trim()
  if (!isRealisticStyle(styleValue)) return base
  if (!base) return REALISTIC_FACE_GRID_IMAGE_PROMPT
  if (
    base.includes(REALISTIC_FACE_GRID_IMAGE_PROMPT)
    || /橙色超幼线网格|ultra-fine orange mesh grid/i.test(base)
  ) {
    return base
  }
  return `${base}, ${REALISTIC_FACE_GRID_IMAGE_PROMPT}`
}

export function withRealisticVideoFaceGridRemoval(styleValue: string | null | undefined, prompt: string) {
  const base = String(prompt || '').trim()
  if (!isRealisticStyle(styleValue)) return base
  if (
    base.includes(REALISTIC_FACE_GRID_VIDEO_PROMPT)
    || /去掉参考图人物脸部的橙色超幼线网格/.test(base)
  ) {
    return base
  }
  return base ? `${base}\n${REALISTIC_FACE_GRID_VIDEO_PROMPT}` : REALISTIC_FACE_GRID_VIDEO_PROMPT
}

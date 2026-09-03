/** Live-action full-image grid: stills add it so Seedance does not treat the photo as a real person; video prompts ask to remove it. */

export const REALISTIC_STYLE_VALUE = 'realistic'

export const REALISTIC_FACE_GRID_IMAGE_PROMPT =
  'overlay a 9x9 white grid across the entire image (pure white #FFFFFF, 100% opacity, 12px-thick lines); nine columns by nine rows spanning the full frame from edge to edge; the grid lines must cut through and visually split every facial feature (eyebrows, eyes, nose, mouth, ears) so no complete feature stays inside a single cell; covering people, clothing, background and all other content; the white grid must stay fully opaque and clearly visible'

export const REALISTIC_FACE_GRID_VIDEO_PROMPT =
  '去掉参考图整张画面上的白色9×9网格（不透明度100%、线宽约12px），把被网格切开的五官重新拼成完整眉眼鼻口耳，还原无网格的自然画面，不得残留格子或白色线。Remove the white 9x9 grid covering the entire reference image (100% opacity, 12px-thick lines); reassemble split facial features into complete eyebrows, eyes, nose, mouth and ears; restore the natural scene with no lattice overlay.'

const LEGACY_IMAGE_FACE_GRID =
  /(?:,\s*)?(?:on every visible human face only, overlay (?:an ultra-fine orange mesh grid|a 6x6 white grid)|overlay a 6x6 white grid across the entire image|overlay a 9x9 white grid across the entire image \(pure white #FFFFFF, 100% opacity, 12px-thick lines\); nine columns by nine rows spanning the full frame from edge to edge, covering people, clothing, background and all other content; the white grid must stay fully opaque and clearly visible)[^.]*(?:\.|$)/gi
const HAS_IMAGE_FACE_GRID =
  /切开(人物)?五官|五官分拆|split every facial feature|visually split every facial feature/i
const HAS_VIDEO_FACE_GRID_REMOVAL =
  /把被网格切开的五官重新拼成|reassemble split facial features/

export function isRealisticStyle(value?: string | null) {
  return String(value || '').trim().toLowerCase() === REALISTIC_STYLE_VALUE
}

function stripLegacyImageFaceGrid(prompt: string) {
  return prompt.replace(LEGACY_IMAGE_FACE_GRID, '').replace(/,\s*$/, '').trim()
}

export function withRealisticCharacterFaceGrid(styleValue: string | null | undefined, prompt: string) {
  const base = stripLegacyImageFaceGrid(String(prompt || '').trim())
  if (!isRealisticStyle(styleValue)) return base
  if (!base) return REALISTIC_FACE_GRID_IMAGE_PROMPT
  if (base.includes(REALISTIC_FACE_GRID_IMAGE_PROMPT) || HAS_IMAGE_FACE_GRID.test(base)) {
    return base
  }
  return `${base}, ${REALISTIC_FACE_GRID_IMAGE_PROMPT}`
}

export function withRealisticVideoFaceGridRemoval(styleValue: string | null | undefined, prompt: string) {
  const base = String(prompt || '').trim()
  if (!isRealisticStyle(styleValue)) return base
  if (
    base.includes(REALISTIC_FACE_GRID_VIDEO_PROMPT)
    || HAS_VIDEO_FACE_GRID_REMOVAL.test(base)
  ) {
    return base
  }
  return base ? `${base}\n${REALISTIC_FACE_GRID_VIDEO_PROMPT}` : REALISTIC_FACE_GRID_VIDEO_PROMPT
}

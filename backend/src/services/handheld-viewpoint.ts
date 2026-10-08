/**
 * "手持鏡頭" is the camera that is filming, not a camera prop in her hands.
 * The viewer is that camera. Nothing here is specific to one script.
 */

const HANDHELD_VIEWPOINT = /手持(?:鏡頭|镜头|自拍)|對(?:著|着)?鏡頭|对(?:着|著)?镜头|看(?:著|着)(?:鏡頭|镜头)|自拍/u

const VISIBLE_CAMERA = /(?:單手|单手|雙手|双手)?手(?:裡|裏|里|中)?(?:拿著|拿着|握著|握着|持著|持着|持)(?:著|着)?(?:一台|一部|一支|一個|一个)?(?:相機|相机|手機|手机|攝錄機|摄录机|錄影機|录影机|穩定器|稳定器|自拍桿|自拍杆|鏡頭|镜头)/gu

const VISIBLE_CAMERA_EN = /\b(?:holding|holds|hold)\s+(?:a|the|her|his)?\s*(?:camera|phone|gimbal|camcorder)\b/gi

export const HANDHELD_VIEWPOINT_TAG = '[CAMERA: Handheld, selfie, or looking into the lens is the camera angle, not a prop. The viewer is the camera. When the host speaks to the audience, they look into the lens with slight handheld sway. A cutaway of a street, kitchen, or food is what that camera sees. Do not show a camera, phone, gimbal, or anyone holding a recording device.]'

export function isHandheldViewpoint(text?: string | null) {
  return HANDHELD_VIEWPOINT.test(String(text || ''))
}

/** Drop a visible camera prop and state that the frame is the handheld camera. */
export function applyHandheldViewpoint(prompt: string, description?: string | null) {
  const source = String(prompt || '').trim()
  const context = `${source}\n${description || ''}`
  if (!isHandheldViewpoint(context)) return source
  const rewritten = source
    .replace(VISIBLE_CAMERA, '看著鏡頭')
    .replace(VISIBLE_CAMERA_EN, 'looking into the lens')
  if (rewritten.includes('[CAMERA:')) return rewritten
  return rewritten ? `${rewritten}\n${HANDHELD_VIEWPOINT_TAG}` : HANDHELD_VIEWPOINT_TAG
}

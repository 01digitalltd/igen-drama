/**
 * 风格预设服务 — 将项目绑定的视觉风格解析为英文提示词片段
 * dramas.style 存 style_presets.value；查不到/已停用时返回空串（调用方走兜底）
 *
 * Image prompts get the preset English fragment.
 * Video models default to live-action unless the clip prompt restates the look,
 * so video generation prepends a stronger VISUAL_STYLE tag.
 */

const STYLE_LABELS: Record<string, string> = {
  '3d': '3D Chibi',
  anime: '日漫赛璐璐',
  ghibli: '吉卜力手绘',
  watercolor: '水彩绘本',
  comic: '美式漫画',
  realistic: '写实真人',
}

/** Video-only guards. Avoid body/skin/human wording — MiniMax 1027 flags those then blocks the clip. */
const VIDEO_STYLE_GUARDS: Record<string, string> = {
  '3d': '3D chibi CG animated short, Unreal Engine game-cinematic render, super-deformed cute 3D CGI characters with oversized heads and small bodies. Reference stills supply product silhouette, label layout and official logo only — restyle rooms, people and packaging as matching 3D chibi CGI; keep the logo mark readable. Not live-action camera footage, not photoreal, not semi-realistic adult proportions.',
  anime: '2D Japanese anime, cel shading, clean line art. Restyle reference stills into this look. Not live-action camera footage.',
  ghibli: 'Hand-drawn Studio Ghibli animation, painted backgrounds. Restyle reference stills into this look. Not live-action camera footage.',
  watercolor: 'Watercolor illustrated animation, paper texture. Restyle reference stills into this look. Not live-action camera footage.',
  comic: 'Western comic-book animation, bold ink outlines, halftone. Restyle reference stills into this look. Not live-action camera footage.',
  realistic: 'Photorealistic live-action cinematic, natural lighting, 35mm film look.',
}

function styleLockTrailer(key: string) {
  if (key === '3d') {
    return '[STYLE_LOCK] Restyle every reference still into 3D chibi CGI (big head, small body). Keep logo artwork and product silhouette. Not live-action camera footage.'
  }
  return '[STYLE_LOCK] Restyle every reference still into the VISUAL_STYLE look. Keep logo artwork and product silhouette. Not live-action camera footage.'
}

export function normalizeStyleValue(raw?: string | null) {
  return String(raw || '').trim().toLowerCase()
}

export function visualStyleLabel(styleValue?: string | null) {
  const key = normalizeStyleValue(styleValue)
  return STYLE_LABELS[key] || ''
}

export function videoVisualStyleText(styleValue?: string | null, stylePrompt?: string | null) {
  const key = normalizeStyleValue(styleValue)
  const guard = VIDEO_STYLE_GUARDS[key] || ''
  const fragment = String(stylePrompt || '').trim()
  if (key && key !== 'realistic') return [guard, fragment].filter(Boolean).join(' ')
  return [fragment, guard].filter(Boolean).join(' ')
}

/** Agent instruction: keep the project's look in video_prompt; do not invent another medium. */
export function visualStyleInstruction(styleValue?: string | null) {
  const key = normalizeStyleValue(styleValue)
  const label = visualStyleLabel(key)
  if (!label) return ''
  if (key === 'realistic') {
    return `【视觉风格｜必须遵守】本项目是${label}。video_prompt 与 image_prompt 全程真人实拍质感，不要改成动画或 3D。`
  }
  if (key === '3d') {
    return `【视觉风格｜必须遵守】本项目是${label}。video_prompt 与 image_prompt 全程是 3D Q版／Chibi CG（头大身小、圆润可爱、游戏引擎渲染）。角色必须写成头大身小；场景空镜必须是同款三维空间，禁止实拍办公室或街道；道具单品必须是同款三维产品渲染，禁止真人产品摄影。禁止「电影质感」「真人皮肤」「毛孔」「写实棚拍」。@场景/@角色/@道具 只提供外形、包装与 Logo，必须写成「转成 3D Chibi CG」，禁止按实拍照片还原。禁止写成真人实拍或半写实成人比例。每一段画面都保持这个画风。`
  }
  return `【视觉风格｜必须遵守】本项目是${label}。video_prompt 与 image_prompt 全程保持该画风。参考图只锁外形，必须转成该画风，禁止按实拍照片还原成真人实拍。`
}

export function assetRestyleKindLabel(kind: 'character' | 'scene' | 'prop') {
  if (kind === 'character') return '角色'
  if (kind === 'scene') return '场景'
  return '道具'
}

export function assetRestyleDirective(kind: 'character' | 'scene' | 'prop', styleValue?: string | null) {
  const label = visualStyleLabel(styleValue) || '项目视觉风格'
  if (kind === 'scene') {
    return `【转风格｜必须遵守】第一张图是用户提供的场景原图。先分析空间布局、出入口与陈设，再整张重绘成「${label}」空场景。保留可辨识布局，禁止原样贴实拍，禁止改成另一种画风。`
  }
  if (kind === 'prop') {
    return `【转风格｜必须遵守】第一张图是用户提供的道具原图。先分析外形、包装与 Logo，再整张重绘成「${label}」单品。保留可辨识特征，禁止原样贴产品照片，禁止改成另一种画风。`
  }
  return `【转风格｜必须遵守】第一张图是用户提供的角色原图。先分析外形、服装、构图与关键细节，再整张重绘成「${label}」。保留可辨识特征，禁止原样贴照片，禁止改成另一种画风。`
}

export function appendAssetRestyleDirective(
  prompt: string,
  kind: 'character' | 'scene' | 'prop',
  styleValue?: string | null,
) {
  const body = String(prompt || '').trim()
  const line = assetRestyleDirective(kind, styleValue)
  if (!line) return body
  if (body.includes('【转风格')) return body
  return [line, body].filter(Boolean).join('\n')
}

/** Chinese lock for the image model. Prompt-writer skills used to say 电影质感, which overpowers a weak English style prefix. */
export type ImageStyleKind = 'character' | 'scene' | 'prop' | 'still'

export function imageStyleLock(styleValue?: string | null, kind?: ImageStyleKind | null) {
  const key = normalizeStyleValue(styleValue)
  const label = visualStyleLabel(key)
  if (!label) return ''
  if (key === 'realistic') {
    if (kind === 'scene') {
      return `【画面风格｜必须遵守】这是空场景参考图。整张必须是写实真人实拍空间，自然光影，不要画成动画或 3D。画面中不要有人物。`
    }
    if (kind === 'prop') {
      return `【画面风格｜必须遵守】这是白底单品图。整张必须是写实产品摄影，自然材质，不要画成动画或 3D。`
    }
    return `【画面风格｜必须遵守】整张必须是写实真人实拍质感，自然皮肤与光影，不要画成动画或 3D。`
  }
  if (key === '3d') {
    if (kind === 'scene') {
      return `【画面风格｜必须遵守】这是空场景参考图。整张必须画成 3D Chibi CG 游戏引擎三维空间：家具、墙面、灯光都是同款 Q 版三维。禁止真人实拍办公室、街道或室内摄影。画面中不要有人物。`
    }
    if (kind === 'prop') {
      return `【画面风格｜必须遵守】这是白底单品图。整张必须画成 3D Chibi CG 三维产品渲染，保留可辨识外形、包装与 Logo。禁止真人产品摄影，禁止实拍静物棚拍。`
    }
    if (kind === 'still') {
      return `【画面风格｜必须遵守】整张必须画成 3D Chibi CG：人物头大身小，场景与道具也是同款游戏引擎三维，禁止真人照片、禁止电影质感、禁止写实棚拍。`
    }
    return `【画面风格｜必须遵守】整张必须画成 3D Chibi CG：头大身小、四肢短圆、Q版可爱、游戏引擎三维渲染。禁止真人照片、禁止电影质感皮肤毛孔、禁止半写实成人比例、禁止写实棚拍。`
  }
  if (kind === 'scene') {
    return `【画面风格｜必须遵守】这是空场景参考图。整张必须画成「${label}」，禁止改成真人实拍或其他画风。画面中不要有人物。`
  }
  if (kind === 'prop') {
    return `【画面风格｜必须遵守】这是白底单品图。整张必须画成「${label}」，禁止改成真人产品摄影或其他画风。`
  }
  return `【画面风格｜必须遵守】整张必须画成「${label}」，禁止改成真人实拍或其他画风。`
}

export function appendImageStyleDirective(
  prompt: string,
  styleValue?: string | null,
  stylePrompt?: string | null,
  kind?: ImageStyleKind | null,
) {
  const body = String(prompt || '').trim()
  const lock = imageStyleLock(styleValue, kind)
  const withLock = lock && !body.includes('【画面风格') ? [lock, body].filter(Boolean).join('\n') : body
  return appendVisualStyleDirective(withLock, styleValue, stylePrompt)
}

export function appendVisualStyleDirective(
  prompt: string,
  styleValue?: string | null,
  stylePrompt?: string | null,
) {
  const key = normalizeStyleValue(styleValue) || 'unset'
  const fragment = videoVisualStyleText(key === 'unset' ? '' : key, stylePrompt)
  const base = String(prompt || '').trim()
  if (!fragment) return base
  if (base.includes('VISUAL_STYLE')) return base
  const tag = `[VISUAL_STYLE: ${key} | ${fragment} Keep this look in every shot.]`
  const lock = key && key !== 'realistic' && key !== 'unset' ? `\n\n${styleLockTrailer(key)}` : ''
  return base ? `${tag}\n\n${base}${lock}` : `${tag}${lock}`
}

/** 查询项目绑定的风格预设英文提示词片段；查不到返回 '' */
export async function getDramaStylePrompt(dramaId: number | null | undefined): Promise<string> {
  const { prompt } = await loadDramaVisualStyle(dramaId)
  return prompt
}

/** dramas.style key, e.g. realistic / 3d / anime */
export async function getDramaStyleValue(dramaId: number | null | undefined): Promise<string> {
  const { value } = await loadDramaVisualStyle(dramaId)
  return value
}

export async function loadDramaVisualStyle(dramaId: number | null | undefined) {
  if (!dramaId) return { value: '', prompt: '' }
  const { and, eq } = await import('../db/query.js')
  const { db, schema } = await import('../db/index.js')
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  const value = String(drama?.style || '').trim()
  if (!value) return { value: '', prompt: '' }
  const [preset] = await db.select().from(schema.stylePresets)
    .where(and(eq(schema.stylePresets.value, value), eq(schema.stylePresets.isActive, true)))
  return { value, prompt: String(preset?.prompt || '').trim() }
}

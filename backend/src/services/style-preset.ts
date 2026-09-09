/**
 * 风格预设服务 — 将项目绑定的视觉风格解析为英文提示词片段
 * dramas.style 存 style_presets.value；查不到/已停用时返回空串（调用方走兜底）
 *
 * Image prompts get the preset English fragment.
 * Video models default to live-action unless the clip prompt restates the look,
 * so video generation prepends a stronger VISUAL_STYLE tag.
 */

const STYLE_LABELS: Record<string, string> = {
  '3d': '3D 漫剧',
  anime: '日漫赛璐璐',
  ghibli: '吉卜力手绘',
  watercolor: '水彩绘本',
  comic: '美式漫画',
  realistic: '写实真人',
}

/** Video-only guards. Image preset copy like "semi-realistic" makes MiniMax go live-action. */
const VIDEO_STYLE_GUARDS: Record<string, string> = {
  '3d': '3D CG animated short-drama, Unreal Engine / game-cinematic render, stylized 3D CGI characters (not real people). NOT photorealistic live-action, NOT real human actors, NOT real photography, NOT documentary, no real skin pores.',
  anime: '2D Japanese anime, cel shading, clean line art. NOT live-action, NOT photoreal, NOT 3D CGI humans.',
  ghibli: 'Hand-drawn Studio Ghibli animation, painted backgrounds. NOT live-action, NOT photoreal.',
  watercolor: 'Watercolor illustrated animation, paper texture. NOT live-action, NOT photoreal.',
  comic: 'Western comic-book animation, bold ink outlines, halftone. NOT live-action, NOT photoreal.',
  realistic: 'Photorealistic live-action cinematic, real human actors, natural skin texture.',
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
    return `【视觉风格｜必须遵守】本项目是${label}。video_prompt 全程真人实拍质感，不要改成动画或 3D。`
  }
  if (key === '3d') {
    return `【视觉风格｜必须遵守】本项目是${label}。video_prompt 全程是 3D CG 动画（游戏引擎渲染、风格化三维角色），禁止写成真人实拍、写实皮肤毛孔、纪录片摄影。每一段画面都保持这个画风。`
  }
  return `【视觉风格｜必须遵守】本项目是${label}。video_prompt 全程保持该画风，禁止改成真人实拍。`
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
  return base ? `${tag}\n\n${base}` : tag
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

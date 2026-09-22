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

/** Image-only. Video keeps Unreal motion language; stills must look like vinyl chibi, not cinematic CG. */
const IMAGE_STYLE_GUARDS: Record<string, string> = {
  '3d': '3D chibi still, Pop Mart vinyl-figure look, super-deformed 1:2 head-to-body ratio, oversized round head, short chubby limbs, huge glossy toy eyes, tiny nose and mouth, smooth plastic/resin, even studio CG lighting. People, rooms and products all match this blind-box toy 3D. Not Unreal cinematic photoreal, not live-action camera footage, not skin pores, not 35mm film, not product photography.',
  anime: '2D Japanese anime still, cel shading, clean line art. Not live-action camera footage.',
  ghibli: 'Hand-drawn Studio Ghibli still, painted backgrounds. Not live-action camera footage.',
  watercolor: 'Watercolor illustrated still, paper texture. Not live-action camera footage.',
  comic: 'Western comic-book still, bold ink outlines, halftone. Not live-action camera footage.',
  realistic: 'Photorealistic live-action cinematic still, natural lighting, 35mm film look.',
}

export function imageVisualStyleText(styleValue?: string | null, _stylePrompt?: string | null) {
  const key = normalizeStyleValue(styleValue)
  if (key === '3d') return IMAGE_STYLE_GUARDS['3d']
  const guard = IMAGE_STYLE_GUARDS[key] || ''
  const fragment = String(_stylePrompt || '').trim()
  if (key && key !== 'realistic') return [guard, fragment].filter(Boolean).join(' ')
  return [fragment, guard].filter(Boolean).join(' ')
}

export function stripImageStyleWrappers(prompt: string) {
  return String(prompt || '')
    .replace(/\[VISUAL_STYLE:[^\]]*\]\s*/g, '')
    .replace(/\[STYLE_LOCK\][^\n]*/g, '')
    .replace(/【画面风格｜必须遵守】[^\n]*/g, '')
    .replace(/【画面风格｜结尾再锁一次】[^\n]*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function scrubPhotorealForChibi(prompt: string, styleValue?: string | null) {
  if (normalizeStyleValue(styleValue) !== '3d') return prompt
  return String(prompt || '')
    .replace(/电影质感/g, '三维卡通光')
    .replace(/真人皮肤/g, '光滑脸部')
    .replace(/皮肤毛孔/g, '')
    .replace(/肤质清晰可见/g, '五官清晰、光滑无毛孔')
    .replace(/肤质清晰/g, '光滑脸部')
    .replace(/写实棚拍/g, '三维棚灯')
    .replace(/均匀棚拍光/g, '均匀三维棚灯')
    .replace(/柔和均匀的光线/g, '均匀三维棚灯')
    .replace(/标准产品摄影(?:视角)?/g, '三维单品渲染')
    .replace(/产品摄影棚拍/g, '三维产品渲染')
    .replace(/cinematic lighting/gi, 'even studio CG lighting')
    .replace(/photoreal(?:istic)?(?: live-action)?/gi, 'stylized 3D')
    .replace(/35mm film look/gi, '')
    .replace(/skin pores/gi, '')
    .replace(/natural skin texture/gi, 'smooth resin')
    .replace(/Unreal Engine(?: \/ game-engine)? cinematic render/gi, 'stylized chibi game render')
    .replace(/game-cinematic render/gi, 'stylized chibi render')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/，{2,}/g, '，')
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
    return `【视觉风格｜必须遵守】本项目是${label}。video_prompt 与 image_prompt 全程是盲盒风 3D Chibi CG：头身比约 1:2，头大身小，四肢短圆，大眼睛，光滑树脂／塑料，均匀三维棚灯。角色必须写成头身比约 1:2；场景空镜必须是同款圆润卡通三维空间，禁止实拍办公室或街道；道具单品必须是同款三维玩具产品，禁止真人产品摄影。禁止「电影质感」「真人皮肤」「毛孔」「写实棚拍」「Unreal 写实」。@场景/@角色/@道具 只提供外形、包装与 Logo，必须写成「转成 3D Chibi 盲盒风」，禁止按实拍照片还原。禁止写成真人实拍或半写实成人比例。每一段画面都保持这个画风。`
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
  const chibi = normalizeStyleValue(styleValue) === '3d'
  if (kind === 'scene') {
    return chibi
      ? `【转风格｜必须遵守】第一张图是用户提供的场景原图。先分析空间布局、出入口与陈设，再整张重绘成 3D Chibi 盲盒风三维空场景：圆润卡通家具、简化空间、均匀三维棚灯。保留可辨识布局，禁止原样贴实拍，禁止保留照片质感。`
      : `【转风格｜必须遵守】第一张图是用户提供的场景原图。先分析空间布局、出入口与陈设，再整张重绘成「${label}」空场景。保留可辨识布局，禁止原样贴实拍，禁止改成另一种画风。`
  }
  if (kind === 'prop') {
    return chibi
      ? `【转风格｜必须遵守】第一张图是用户提供的道具原图。先分析外形、包装与 Logo，再整张重绘成 3D Chibi 盲盒风三维单品：圆润简化、光滑树脂。保留可辨识特征，禁止原样贴产品照片，禁止保留照片质感。`
      : `【转风格｜必须遵守】第一张图是用户提供的道具原图。先分析外形、包装与 Logo，再整张重绘成「${label}」单品。保留可辨识特征，禁止原样贴产品照片，禁止改成另一种画风。`
  }
  return chibi
    ? `【转风格｜必须遵守】第一张图是用户提供的角色原图。先分析外形、服装与关键细节，再整张重绘成 3D Chibi 盲盒风三维角色：头身比约 1:2，头大身小，光滑树脂，没有毛孔。保留可辨识特征，禁止原样贴照片，禁止保留照片质感。`
    : `【转风格｜必须遵守】第一张图是用户提供的角色原图。先分析外形、服装、构图与关键细节，再整张重绘成「${label}」。保留可辨识特征，禁止原样贴照片，禁止改成另一种画风。`
}

export function appendAssetRestyleDirective(
  prompt: string,
  kind: 'character' | 'scene' | 'prop',
  styleValue?: string | null,
) {
  const body = String(prompt || '').replace(/【转风格｜必须遵守】[^\n]*\n?/g, '').trim()
  const line = assetRestyleDirective(kind, styleValue)
  if (!line) return body
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
      return `【画面风格｜必须遵守】这是空场景参考图。整张必须画成 3D Chibi 盲盒风三维空间：圆润卡通家具、简化墙面与灯光、均匀三维棚灯，像游戏里的 Q 版场景。禁止真人实拍办公室、街道或室内摄影，禁止 Unreal 写实光影。画面中不要有人物。`
    }
    if (kind === 'prop') {
      return `【画面风格｜必须遵守】这是白底单品图。整张必须画成 3D Chibi 盲盒风三维产品：圆润简化外形、光滑树脂／塑料，保留可辨识外形、包装与 Logo。禁止真人产品摄影，禁止实拍静物棚拍。`
    }
    if (kind === 'still') {
      return `【画面风格｜必须遵守】整张必须画成 3D Chibi 盲盒风：人物头身比约 1:2、头大身小、光滑树脂；场景与道具也是同款圆润三维。禁止真人照片、禁止电影质感、禁止 Unreal 写实。`
    }
    return `【画面风格｜必须遵守】整张必须画成 3D Chibi 盲盒风三维角色：头身比约 1:2，头大身小，头约占身高一半，四肢短圆，大而亮的卡通眼睛，小鼻子小嘴，光滑树脂／塑料材质，没有皮肤毛孔。均匀三维棚灯，纯白背景。禁止真人照片、禁止电影质感、禁止半写实成人比例、禁止 Unreal 写实。`
  }
  if (kind === 'scene') {
    return `【画面风格｜必须遵守】这是空场景参考图。整张必须画成「${label}」，禁止改成真人实拍或其他画风。画面中不要有人物。`
  }
  if (kind === 'prop') {
    return `【画面风格｜必须遵守】这是白底单品图。整张必须画成「${label}」，禁止改成真人产品摄影或其他画风。`
  }
  return `【画面风格｜必须遵守】整张必须画成「${label}」，禁止改成真人实拍或其他画风。`
}

function imageStyleLockTrailer(key: string, kind?: ImageStyleKind | null) {
  if (key !== '3d') {
    return key && key !== 'realistic' && key !== 'unset'
      ? '\n\n[STYLE_LOCK] Restyle every reference still into the VISUAL_STYLE look. Keep logo artwork and product silhouette. Not live-action camera footage.'
      : ''
  }
  if (kind === 'scene') {
    return '\n\n【画面风格｜结尾再锁一次】空场景必须是 3D Chibi 盲盒风三维空间，圆润卡通家具，禁止实拍与电影质感。'
  }
  if (kind === 'prop') {
    return '\n\n【画面风格｜结尾再锁一次】单品必须是 3D Chibi 盲盒风三维产品，光滑树脂，禁止真人产品摄影。'
  }
  return '\n\n【画面风格｜结尾再锁一次】必须是 3D Chibi 盲盒风：头身比约 1:2，头大身小，光滑树脂，禁止真人照片与电影质感。'
}

export function appendImageStyleDirective(
  prompt: string,
  styleValue?: string | null,
  stylePrompt?: string | null,
  kind?: ImageStyleKind | null,
) {
  const key = normalizeStyleValue(styleValue) || 'unset'
  const body = scrubPhotorealForChibi(stripImageStyleWrappers(prompt), key)
  const lock = imageStyleLock(key, kind)
  const withLock = lock ? [lock, body].filter(Boolean).join('\n') : body
  const fragment = imageVisualStyleText(key === 'unset' ? '' : key, stylePrompt)
  if (!fragment) return withLock
  const tag = `[VISUAL_STYLE: ${key} | ${fragment} Keep this look in every shot.]`
  return `${tag}\n\n${withLock}${imageStyleLockTrailer(key, kind)}`
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

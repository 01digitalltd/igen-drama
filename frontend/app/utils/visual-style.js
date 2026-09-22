export function normalizeStyleValue(raw) {
  return String(raw || '').trim().toLowerCase()
}

const STYLE_LABELS = {
  '3d': '3D Chibi',
  anime: '日漫赛璐璐',
  ghibli: '吉卜力手绘',
  watercolor: '水彩绘本',
  comic: '美式漫画',
  realistic: '写实真人',
}

export function visualStyleInstruction(styleRaw) {
  const key = normalizeStyleValue(styleRaw)
  const label = STYLE_LABELS[key]
  if (!label) return ''
  if (key === 'realistic') {
    return `【视觉风格｜必须遵守】本项目是${label}。video_prompt 全程真人实拍质感，不要改成动画或 3D。`
  }
  if (key === '3d') {
    return `【视觉风格｜必须遵守】本项目是${label}。video_prompt 全程是盲盒风 3D Chibi CG：头身比约 1:2，头大身小，光滑树脂，均匀三维棚灯。角色必须写成头身比约 1:2；场景空镜必须是同款圆润卡通三维空间，禁止实拍办公室；道具单品必须是同款三维玩具产品，禁止真人产品摄影。禁止「电影质感」「真人皮肤」。@场景/@角色/@道具 只提供外形、包装与 Logo，必须写成「转成 3D Chibi 盲盒风」，禁止按实拍照片还原办公室或桌面广告。禁止写成真人实拍或半写实成人比例。每一段画面都保持这个画风。`
  }
  return `【视觉风格｜必须遵守】本项目是${label}。video_prompt 全程保持该画风。参考图只锁外形，必须转成该画风，禁止按实拍照片还原成真人实拍。`
}

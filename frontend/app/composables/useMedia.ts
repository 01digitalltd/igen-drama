/**
 * 媒体地址辅助 — 列表/卡片用缩略图与海报帧，大图预览仍用原图
 *
 * 命名约定（后端生成产物时自动产出，见 backend/src/utils/storage.ts、video-poster.ts）：
 *   图片 …/images/x.png      → 缩略图 …/images/x_thumb.webp
 *   视频 …/videos|merged/x.mp4 → 海报帧 …/videos|merged/x_poster.jpg
 * 存量本地 static 文件可用 `npm run backfill-artwork`（backend）补齐。
 */

function isDerivedMediaUrl(url: string): boolean {
  return url.includes('/static/') || url.includes('/drama/')
}

/** 图片地址 → 缩略图地址；无法推导时原样返回 */
export function thumbOf(url: string): string {
  if (!url || !isDerivedMediaUrl(url)) return url
  if (!/\.(png|jpe?g|webp|gif)$/i.test(url.split('?')[0])) return url
  return url.replace(/\.[^./?#]+(?=($|\?|#))/, '_thumb.webp')
}

/** 缩略图加载失败（老数据未回填）时回退原图 */
export function thumbFallback(e: Event, orig: string) {
  const el = e.target as HTMLImageElement
  if (!el || el.dataset.fbk || !orig) return
  el.dataset.fbk = '1'
  el.src = orig
}

/** 视频地址 → 海报帧地址；无法推导时返回空串，不设置 poster */
export function posterOf(url: string): string {
  if (!url || !isDerivedMediaUrl(url)) return ''
  if (!/\.(mp4|webm|mov)$/i.test(url.split('?')[0])) return ''
  return url.replace(/\.[^./?#]+(?=($|\?|#))/, '_poster.jpg')
}

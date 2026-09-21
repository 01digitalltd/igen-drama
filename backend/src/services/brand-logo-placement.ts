import { parseDramaMetadata } from '../utils/ad-taxonomy.js'

export const LOGO_PLACEMENT_END = 'end'
export const LOGO_PLACEMENT_ALL = 'all'
export type LogoPlacement = typeof LOGO_PLACEMENT_END | typeof LOGO_PLACEMENT_ALL

export function normalizeLogoPlacement(raw?: unknown): LogoPlacement {
  return String(raw || '').trim().toLowerCase() === LOGO_PLACEMENT_ALL ? LOGO_PLACEMENT_ALL : LOGO_PLACEMENT_END
}

export function logoPlacementFromMetadata(raw?: unknown): LogoPlacement {
  const meta = parseDramaMetadata(raw)
  return normalizeLogoPlacement(meta.logo_placement)
}

export function mergeLogoPlacementMetadata(existing: unknown, placement?: unknown): string {
  const meta = parseDramaMetadata(existing)
  meta.logo_placement = normalizeLogoPlacement(placement ?? meta.logo_placement)
  return JSON.stringify(meta)
}

export function shotNeedsBrandLogo(
  placement: unknown,
  storyboardNumber?: number | null,
  maxNumber?: number | null,
) {
  if (normalizeLogoPlacement(placement) === LOGO_PLACEMENT_ALL) return true
  const n = Number(storyboardNumber) || 0
  const max = Number(maxNumber) || 0
  return max > 0 && n === max
}

export function logoPlacementInstruction(placement?: unknown) {
  if (normalizeLogoPlacement(placement) === LOGO_PLACEMENT_ALL) {
    return '【Logo放置｜必须遵守】全片每一镜都要出现用户上传的官方品牌Logo。每一镜 prop_ids 都必须绑定品牌Logo；画面角落、包装或店招可见原件，禁止重绘。'
  }
  return '【Logo放置｜必须遵守】品牌Logo 只在最后一镜片尾露出。只有最后一镜绑定品牌Logo；前面各镜不要写 Logo、不要绑定该道具。'
}

export function appendBrandLogoDirective(prompt: string, needed: boolean) {
  const body = String(prompt || '').trim()
  if (!needed) return body
  if (/品牌Logo|brand logo/i.test(body)) return body
  return [body, '画面需出现用户上传的官方品牌Logo，使用参考图原件，禁止重绘或改字。'].filter(Boolean).join('\n')
}

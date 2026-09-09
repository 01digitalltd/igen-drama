/**
 * Project category stored on dramas.genre.
 * Existing rows with null/unknown genre behave as short drama.
 */
export const PROJECT_CATEGORY_SHORT_DRAMA = 'short_drama'
export const PROJECT_CATEGORY_AD_PROMO = 'ad_promo'

export const PROJECT_CATEGORIES = [PROJECT_CATEGORY_SHORT_DRAMA, PROJECT_CATEGORY_AD_PROMO] as const
export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number]

export const BRAND_LOGO_PROP_TYPE = '品牌Logo'
export const BRAND_LOGO_PROP_NAME = '品牌Logo'

const AD_PROMO_ALIASES = new Set([
  'ad_promo',
  'ad-promo',
  'adpromo',
  'ad',
  'ads',
  'advert',
  'advertisement',
  '廣告推廣',
  '广告推广',
  '廣告',
  '广告',
])

export function isProjectCategory(value: unknown): value is ProjectCategory {
  return value === PROJECT_CATEGORY_SHORT_DRAMA || value === PROJECT_CATEGORY_AD_PROMO
}

export function normalizeProjectCategory(raw?: string | null): ProjectCategory {
  const value = String(raw || '').trim()
  if (isProjectCategory(value)) return value
  const compact = value.toLowerCase().replace(/[\s-]+/g, '_')
  if (AD_PROMO_ALIASES.has(value) || AD_PROMO_ALIASES.has(compact)) return PROJECT_CATEGORY_AD_PROMO
  return PROJECT_CATEGORY_SHORT_DRAMA
}

export function isAdPromoCategory(raw?: string | null): boolean {
  return normalizeProjectCategory(raw) === PROJECT_CATEGORY_AD_PROMO
}

export function defaultAspectRatioForCategory(raw?: string | null): '16:9' | '9:16' {
  return isAdPromoCategory(raw) ? '9:16' : '16:9'
}

export function isBrandLogoProp(prop: { type?: string | null; name?: string | null } | null | undefined): boolean {
  if (!prop) return false
  const type = String(prop.type || '').trim()
  const name = String(prop.name || '').trim()
  if (type === BRAND_LOGO_PROP_TYPE) return true
  if (name === BRAND_LOGO_PROP_NAME) return true
  if (/logo/i.test(type)) return true
  if (/品牌/.test(name) && /logo/i.test(name)) return true
  return false
}

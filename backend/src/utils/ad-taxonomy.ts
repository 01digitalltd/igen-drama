/**
 * Ad-promo creative taxonomy stored on dramas.metadata.
 * genre stays short_drama | ad_promo; these fields only apply when genre is ad_promo.
 */
export const AD_PURPOSES = [
  'product_sell',
  'edu_info',
  'brand_image',
  'ugc_review',
  'store_visit',
  'campaign_event',
] as const
export type AdPurpose = (typeof AD_PURPOSES)[number]

export const AD_FORMS = ['talent_explain', 'product_showcase'] as const
export type AdForm = (typeof AD_FORMS)[number]

export const AD_ANGLES = [
  'pain_hook',
  'host_demo',
  'testimonial',
  'offer_push',
  'pack_hero',
  'use_demo',
  'benefit_cuts',
  'unbox',
  'expert_talk',
  'step_lesson',
  'myth_bust',
  'faq',
  'compare_teach',
  'how_it_works',
  'feature_tour',
  'spec_story',
  'before_after',
  'founder_story',
  'values_talk',
  'craft_tour',
  'cinematic_pack',
  'origin_process',
  'lifestyle_set',
  'selfie_review',
  'first_use',
  'honest_proscons',
  'handheld_demo',
  'overlay_review',
  'day_in_life',
  'greeter_invite',
  'in_store_tour',
  'local_offer',
  'shelf_hero',
  'walk_in',
  'pickup_cta',
  'host_announce',
  'countdown_talk',
  'event_invite',
  'key_visual',
  'bundle_show',
  'flash_cuts',
] as const
export type AdAngle = (typeof AD_ANGLES)[number]

export type AdTaxonomy = {
  purpose: AdPurpose
  form: AdForm
  angle: AdAngle
}

export const DEFAULT_AD_PURPOSE: AdPurpose = 'product_sell'
export const DEFAULT_AD_FORM: AdForm = 'product_showcase'

export const AD_ANGLE_MAP: Record<AdPurpose, Record<AdForm, readonly AdAngle[]>> = {
  product_sell: {
    talent_explain: ['pain_hook', 'host_demo', 'testimonial', 'offer_push'],
    product_showcase: ['pack_hero', 'use_demo', 'benefit_cuts', 'unbox'],
  },
  edu_info: {
    talent_explain: ['expert_talk', 'step_lesson', 'myth_bust', 'faq', 'compare_teach'],
    product_showcase: ['how_it_works', 'feature_tour', 'spec_story', 'before_after'],
  },
  brand_image: {
    talent_explain: ['founder_story', 'values_talk', 'craft_tour'],
    product_showcase: ['cinematic_pack', 'origin_process', 'lifestyle_set'],
  },
  ugc_review: {
    talent_explain: ['selfie_review', 'first_use', 'honest_proscons'],
    product_showcase: ['handheld_demo', 'overlay_review', 'day_in_life'],
  },
  store_visit: {
    talent_explain: ['greeter_invite', 'in_store_tour', 'local_offer'],
    product_showcase: ['shelf_hero', 'walk_in', 'pickup_cta'],
  },
  campaign_event: {
    talent_explain: ['host_announce', 'countdown_talk', 'event_invite'],
    product_showcase: ['key_visual', 'bundle_show', 'flash_cuts'],
  },
}

export const AD_SHARED_SKILL = 'ad-promo'

export const AD_PURPOSE_SKILL: Record<AdPurpose, string> = {
  product_sell: 'ad-product-sell',
  edu_info: 'ad-edu-info',
  brand_image: 'ad-brand-image',
  ugc_review: 'ad-ugc-review',
  store_visit: 'ad-store-visit',
  campaign_event: 'ad-campaign-event',
}

export const AD_FORM_SKILL: Record<AdForm, string> = {
  talent_explain: 'ad-form-talent',
  product_showcase: 'ad-form-product',
}

export function isAdPurpose(value: unknown): value is AdPurpose {
  return typeof value === 'string' && (AD_PURPOSES as readonly string[]).includes(value)
}

export function isAdForm(value: unknown): value is AdForm {
  return typeof value === 'string' && (AD_FORMS as readonly string[]).includes(value)
}

export function isAdAngle(value: unknown): value is AdAngle {
  return typeof value === 'string' && (AD_ANGLES as readonly string[]).includes(value)
}

export function defaultFormForPurpose(purpose: AdPurpose): AdForm {
  if (purpose === 'edu_info' || purpose === 'ugc_review' || purpose === 'brand_image') return 'talent_explain'
  return 'product_showcase'
}

export function anglesFor(purpose: AdPurpose, form: AdForm): readonly AdAngle[] {
  return AD_ANGLE_MAP[purpose][form]
}

export function parseDramaMetadata(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) return { ...(raw as Record<string, unknown>) }
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text) return {}
    try {
      const parsed = JSON.parse(text) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...(parsed as Record<string, unknown>) }
      }
    } catch {
      return {}
    }
  }
  return {}
}

export function normalizeAdTaxonomy(input?: {
  purpose?: string | null
  form?: string | null
  angle?: string | null
  ad_purpose?: string | null
  ad_form?: string | null
  ad_angle?: string | null
} | null): AdTaxonomy {
  const purpose = isAdPurpose(input?.purpose || input?.ad_purpose) ? (input?.purpose || input?.ad_purpose) as AdPurpose : DEFAULT_AD_PURPOSE
  const requestedForm = input?.form || input?.ad_form
  const form = isAdForm(requestedForm) ? requestedForm : defaultFormForPurpose(purpose)
  const allowed = anglesFor(purpose, form)
  const requestedAngle = input?.angle || input?.ad_angle
  const angle = isAdAngle(requestedAngle) && allowed.includes(requestedAngle) ? requestedAngle : allowed[0]
  return { purpose, form, angle }
}

export function taxonomyFromMetadata(raw: unknown): AdTaxonomy {
  const meta = parseDramaMetadata(raw)
  return normalizeAdTaxonomy({
    purpose: typeof meta.ad_purpose === 'string' ? meta.ad_purpose : null,
    form: typeof meta.ad_form === 'string' ? meta.ad_form : null,
    angle: typeof meta.ad_angle === 'string' ? meta.ad_angle : null,
  })
}

export function mergeAdTaxonomyMetadata(existing: unknown, spec: AdTaxonomy): string {
  const meta = parseDramaMetadata(existing)
  meta.ad_purpose = spec.purpose
  meta.ad_form = spec.form
  meta.ad_angle = spec.angle
  return JSON.stringify(meta)
}

export function allAdSkillDirs(): string[] {
  return [AD_SHARED_SKILL, ...new Set(Object.values(AD_PURPOSE_SKILL)), ...new Set(Object.values(AD_FORM_SKILL))]
}

export function adSkillDirsFor(spec: AdTaxonomy): string[] {
  return [AD_SHARED_SKILL, AD_PURPOSE_SKILL[spec.purpose], AD_FORM_SKILL[spec.form]]
}

export function adContextFields(spec: AdTaxonomy | null, genre: string) {
  return {
    project_category: genre,
    ad_purpose: spec?.purpose ?? null,
    ad_form: spec?.form ?? null,
    ad_angle: spec?.angle ?? null,
  }
}

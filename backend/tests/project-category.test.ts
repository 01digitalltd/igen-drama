import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BRAND_LOGO_PROP_NAME,
  BRAND_LOGO_PROP_TYPE,
  defaultAspectRatioForCategory,
  isAdPromoCategory,
  isBrandLogoProp,
  normalizeProjectCategory,
} from '../src/utils/project-category.ts'

test('unknown or empty genre stays short drama', () => {
  assert.equal(normalizeProjectCategory(null), 'short_drama')
  assert.equal(normalizeProjectCategory(''), 'short_drama')
  assert.equal(normalizeProjectCategory('romance'), 'short_drama')
  assert.equal(isAdPromoCategory('short_drama'), false)
})

test('normalizes ad-promo aliases including Chinese labels', () => {
  assert.equal(normalizeProjectCategory('ad_promo'), 'ad_promo')
  assert.equal(normalizeProjectCategory('ad-promo'), 'ad_promo')
  assert.equal(normalizeProjectCategory('廣告推廣'), 'ad_promo')
  assert.equal(normalizeProjectCategory('广告推广'), 'ad_promo')
  assert.equal(isAdPromoCategory('ad_promo'), true)
  assert.equal(defaultAspectRatioForCategory('ad_promo'), '9:16')
  assert.equal(defaultAspectRatioForCategory('short_drama'), '16:9')
})

test('detects the reserved brand-logo prop without treating generic products as logos', () => {
  assert.equal(isBrandLogoProp({ name: BRAND_LOGO_PROP_NAME, type: BRAND_LOGO_PROP_TYPE }), true)
  assert.equal(isBrandLogoProp({ name: '官方品牌Logo', type: '装饰' }), true)
  assert.equal(isBrandLogoProp({ name: '护手霜', type: '产品' }), false)
  assert.equal(isBrandLogoProp({ name: '信物', type: '文件' }), false)
})

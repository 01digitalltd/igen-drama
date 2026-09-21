import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  appendBrandLogoDirective,
  logoPlacementFromMetadata,
  logoPlacementInstruction,
  mergeLogoPlacementMetadata,
  normalizeLogoPlacement,
  shotNeedsBrandLogo,
} from '../src/services/brand-logo-placement.ts'

test('logo placement defaults to end and only the last shot needs the mark', () => {
  assert.equal(normalizeLogoPlacement(undefined), 'end')
  assert.equal(normalizeLogoPlacement('ALL'), 'all')
  assert.equal(shotNeedsBrandLogo('all', 1, 3), true)
  assert.equal(shotNeedsBrandLogo('end', 1, 3), false)
  assert.equal(shotNeedsBrandLogo('end', 3, 3), true)
  assert.equal(shotNeedsBrandLogo('end', 0, 0), false)
})

test('metadata round-trips logo_placement without dropping other keys', () => {
  const merged = mergeLogoPlacementMetadata({ ad_purpose: 'product_sell' }, 'all')
  assert.equal(logoPlacementFromMetadata(merged), 'all')
  assert.match(merged, /product_sell/)
  assert.equal(logoPlacementFromMetadata(mergeLogoPlacementMetadata(merged, 'nope')), 'end')
})

test('video prompt gets a logo line only when this shot should show it', () => {
  assert.equal(appendBrandLogoDirective('0-3秒：抬头', false), '0-3秒：抬头')
  assert.match(appendBrandLogoDirective('0-3秒：抬头', true), /品牌Logo/)
  assert.equal(
    appendBrandLogoDirective('画面已有品牌Logo原件。', true),
    '画面已有品牌Logo原件。',
  )
})

test('placement instruction tells the breaker all vs last shot only', () => {
  assert.match(logoPlacementInstruction('all'), /全片每一镜/)
  assert.match(logoPlacementInstruction('end'), /最后一镜/)
})

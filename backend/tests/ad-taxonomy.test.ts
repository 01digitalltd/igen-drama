import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AD_PURPOSES,
  adSkillDirsFor,
  allAdSkillDirs,
  defaultFormForPurpose,
  mergeAdTaxonomyMetadata,
  normalizeAdTaxonomy,
  taxonomyFromMetadata,
} from '../src/utils/ad-taxonomy.ts'

test('defaults missing ad taxonomy to product sell + product showcase', () => {
  const spec = normalizeAdTaxonomy(null)
  assert.equal(spec.purpose, 'product_sell')
  assert.equal(spec.form, 'product_showcase')
  assert.equal(spec.angle, 'pack_hero')
})

test('edu info defaults to talent explain and a teaching angle', () => {
  assert.equal(defaultFormForPurpose('edu_info'), 'talent_explain')
  const spec = normalizeAdTaxonomy({ purpose: 'edu_info' })
  assert.equal(spec.form, 'talent_explain')
  assert.equal(spec.angle, 'expert_talk')
})

test('invalid angle for the selected combo falls back to the first option', () => {
  const spec = normalizeAdTaxonomy({
    purpose: 'edu_info',
    form: 'talent_explain',
    angle: 'unbox',
  })
  assert.equal(spec.angle, 'expert_talk')
})

test('reads taxonomy from drama metadata json', () => {
  const spec = taxonomyFromMetadata(JSON.stringify({
    ad_purpose: 'edu_info',
    ad_form: 'product_showcase',
    ad_angle: 'how_it_works',
  }))
  assert.deepEqual(spec, {
    purpose: 'edu_info',
    form: 'product_showcase',
    angle: 'how_it_works',
  })
})

test('skill dirs cover shared + creative + purpose + form without dropping any purpose', () => {
  const all = new Set(allAdSkillDirs())
  assert.ok(all.has('ad-promo'))
  assert.ok(all.has('ad-creative-director'))
  assert.ok(all.has('ad-form-talent'))
  assert.ok(all.has('ad-form-product'))
  assert.ok(all.has('ad-form-drama'))
  for (const purpose of AD_PURPOSES) {
    const dirs = adSkillDirsFor(normalizeAdTaxonomy({ purpose }))
    assert.equal(dirs[0], 'ad-promo')
    assert.equal(dirs[1], 'ad-creative-director')
    assert.equal(dirs.length, 4)
    dirs.forEach((dir) => assert.ok(all.has(dir)))
  }
})

test('short-drama promo form keeps a mini-story angle', () => {
  const spec = normalizeAdTaxonomy({ purpose: 'product_sell', form: 'drama_promo' })
  assert.equal(spec.form, 'drama_promo')
  assert.equal(spec.angle, 'conflict_save')
})

test('merge keeps unrelated metadata keys', () => {
  const merged = mergeAdTaxonomyMetadata({ theme: 'summer' }, normalizeAdTaxonomy({ purpose: 'store_visit' }))
  const parsed = JSON.parse(merged)
  assert.equal(parsed.theme, 'summer')
  assert.equal(parsed.ad_purpose, 'store_visit')
})

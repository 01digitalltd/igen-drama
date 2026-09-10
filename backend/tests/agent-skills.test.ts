import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentUsesAdSkills, skillDirsForAgent } from '../src/agents/skill-dirs.ts'

test('ad brief skills stay off the prompt generator', () => {
  assert.equal(agentUsesAdSkills('script_rewriter'), true)
  assert.equal(agentUsesAdSkills('extractor'), true)
  assert.equal(agentUsesAdSkills('storyboard_breaker'), true)
  assert.equal(agentUsesAdSkills('prompt_generator'), false)
})

test('ad projects inject purpose, form and creative skills into rewrite/extract/breakdown', () => {
  const spec = { purpose: 'product_sell', form: 'drama_promo', angle: 'conflict_save' }
  const rewriter = skillDirsForAgent('script_rewriter', 'ad_promo', spec)
  assert.ok(rewriter.includes('ad-promo'))
  assert.ok(rewriter.includes('ad-creative-director'))
  assert.ok(rewriter.includes('ad-product-sell'))
  assert.ok(rewriter.includes('ad-form-drama'))

  const extractor = skillDirsForAgent('extractor', 'ad_promo', spec)
  assert.ok(extractor.includes('ad-creative-director'))

  const breaker = skillDirsForAgent('storyboard_breaker', 'ad_promo', spec)
  assert.ok(breaker.includes('ad-creative-director'))

  const prompts = skillDirsForAgent('prompt_generator', 'ad_promo', spec)
  assert.ok(prompts.some(dir => dir.startsWith('prompt-generator/video-prompt')))
  assert.equal(prompts.some(dir => dir.startsWith('ad-')), false)
  assert.equal(prompts.includes('ad-creative-director'), false)
})

test('short drama never loads ad skill dirs', () => {
  const dirs = skillDirsForAgent('script_rewriter', 'short_drama', {
    purpose: 'product_sell',
    form: 'product_showcase',
    angle: 'pack_hero',
  })
  assert.equal(dirs.some(dir => dir.startsWith('ad-')), false)
})

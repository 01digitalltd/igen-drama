import { test } from 'node:test'
import assert from 'node:assert/strict'
import { idsToRetire } from '../src/services/episode-asset-clear-plan.ts'

test('clearing an episode drops its assets and keeps a shared one plus the logo', () => {
  const links = [
    { episodeId: 1, assetId: 10 },
    { episodeId: 1, assetId: 11 },
    { episodeId: 2, assetId: 11 },
    { episodeId: 1, assetId: 12 },
  ]
  const plan = idsToRetire(1, links, [12])
  assert.deepEqual(plan.unlink, [10, 11])
  assert.deepEqual(plan.remove, [10])
})

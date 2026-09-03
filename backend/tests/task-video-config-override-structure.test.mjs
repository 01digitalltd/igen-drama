import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const route = readFileSync(new URL('../src/routes/tasks.ts', import.meta.url), 'utf8')

test('video generation honors request config_id over the episode lock', () => {
  assert.match(route, /Number\(body\.config_id\)/)
  assert.match(route, /if \(configId == null && locked != null\) configId = locked/)
  assert.doesNotMatch(route, /if \(locked != null\) configId = locked/)
})

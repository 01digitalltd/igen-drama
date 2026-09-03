import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const route = readFileSync(new URL('../src/routes/tasks.ts', import.meta.url), 'utf8')

test('video generation honors request config_id over the episode lock', () => {
  assert.match(route, /Number\(body\.config_id\)/)
  assert.match(route, /if \(configId == null && locked != null\) configId = locked/)
  assert.doesNotMatch(route, /if \(locked != null\) configId = locked/)
})

test('video generation blocks Seedance for realistic dramas', () => {
  const generation = readFileSync(new URL('../src/services/generation.ts', import.meta.url), 'utf8')
  assert.match(generation, /assertSeedanceAllowedForStyle/)
  assert.match(generation, /excludeProviders: \['volcengine'\]/)
})

test('video generation duration follows the prompt timeline instead of the request body', () => {
  const generation = readFileSync(new URL('../src/services/generation.ts', import.meta.url), 'utf8')
  assert.match(generation, /resolveVideoGenerationDuration/)
  assert.match(generation, /parseVideoPromptDurationSeconds|shotDuration/)
  assert.doesNotMatch(generation, /duration: params\.duration \|\| 5/)
})

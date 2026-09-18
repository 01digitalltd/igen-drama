import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('drama server injects websocket upgrades for episode jobs', () => {
  const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  const ws = readFileSync(new URL('../src/routes/episode-ws.ts', import.meta.url), 'utf8')
  assert.match(index, /createNodeWebSocket/)
  assert.match(index, /injectWebSocket\(server\)/)
  assert.match(ws, /\/api\/v1\/episodes\/:id\/ws/)
  assert.match(ws, /type === 'poll'/)
})

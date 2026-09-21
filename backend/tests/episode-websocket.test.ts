import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('drama server injects websocket upgrades for episode jobs', () => {
  const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  const helper = readFileSync(new URL('../src/lib/node-ws.ts', import.meta.url), 'utf8')
  const ws = readFileSync(new URL('../src/routes/episode-ws.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(index, /@hono\/node-server\/ws/)
  assert.match(index, /from '\.\/lib\/node-ws\.js'/)
  assert.match(index, /injectWebSocket\(server\)/)
  assert.match(helper, /WebSocketServer/)
  assert.match(helper, /from 'ws'/)
  assert.match(ws, /\/api\/v1\/episodes\/:id\/ws/)
  assert.match(ws, /type === 'poll'/)
})

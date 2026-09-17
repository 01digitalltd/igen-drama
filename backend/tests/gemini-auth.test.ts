import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyGeminiAuth,
  createGeminiProxyFetch,
  isOfficialGeminiHost,
  normalizeGeminiBaseUrl,
  unwrapGeminiProxyPayload,
} from '../src/services/adapters/gemini-auth.ts'

test('official Gemini host detection and /v1 strip', () => {
  assert.equal(isOfficialGeminiHost('https://generativelanguage.googleapis.com'), true)
  assert.equal(isOfficialGeminiHost('https://api.apimart.ai'), false)
  assert.equal(normalizeGeminiBaseUrl('https://api.apimart.ai/v1'), 'https://api.apimart.ai')
  assert.equal(normalizeGeminiBaseUrl('https://api.apimart.ai/'), 'https://api.apimart.ai')
  assert.equal(
    normalizeGeminiBaseUrl('https://generativelanguage.googleapis.com'),
    'https://generativelanguage.googleapis.com',
  )
})

test('official Gemini auth uses query key and goog header', () => {
  const url = new URL('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent')
  const headers: Record<string, string> = {}
  applyGeminiAuth(url, headers, 'https://generativelanguage.googleapis.com', 'google-key')
  assert.equal(url.searchParams.get('key'), 'google-key')
  assert.equal(headers['x-goog-api-key'], 'google-key')
  assert.equal(headers.Authorization, undefined)
})

test('APIMart Gemini auth uses Bearer and strips query key', () => {
  const url = new URL('https://api.apimart.ai/v1beta/models/x:generateContent?key=leak')
  const headers: Record<string, string> = { 'x-goog-api-key': 'leak' }
  applyGeminiAuth(url, headers, 'https://api.apimart.ai', 'sk-proxy')
  assert.equal(url.searchParams.get('key'), null)
  assert.equal(headers['x-goog-api-key'], undefined)
  assert.equal(headers.Authorization, 'Bearer sk-proxy')
})

test('unwraps APIMart { code, data } Gemini envelopes', () => {
  const inner = { candidates: [{ content: { parts: [{ text: 'hi' }] } }] }
  assert.deepEqual(unwrapGeminiProxyPayload({ code: 200, data: inner }), inner)
  assert.deepEqual(unwrapGeminiProxyPayload(inner), inner)
})

test('proxy fetch adds Bearer, strips goog key, and unwraps JSON', async () => {
  const fetchImpl = createGeminiProxyFetch('sk-proxy', async (input, init) => {
    const url = String(input)
    assert.doesNotMatch(url, /[?&]key=/)
    const headers = new Headers(init?.headers)
    assert.equal(headers.get('Authorization'), 'Bearer sk-proxy')
    assert.equal(headers.get('x-goog-api-key'), null)
    return new Response(JSON.stringify({
      code: 200,
      data: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
    }), { headers: { 'content-type': 'application/json' } })
  })

  const res = await fetchImpl('https://api.apimart.ai/v1beta/models/x:generateContent?key=google', {
    headers: { 'x-goog-api-key': 'google' },
  })
  const json = await res.json()
  assert.equal(json.candidates[0].content.parts[0].text, 'ok')
  assert.equal(json.code, undefined)
})

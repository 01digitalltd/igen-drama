/**
 * At render time, rewrite only the lines that will be spoken into the
 * project's dialogue language. Storyboard descriptions stay in the writing language.
 */
import { spokenLineRewriteInstruction } from '../dialogue-language.js'
import { logTaskWarn } from '../../utils/task-logger.js'
import { extractSpokenLines, substituteSpokenLines } from './vo-speech.js'

const REWRITE_TIMEOUT_MS = 20_000

export function parseSpokenRewrite(raw: string, count: number): string[] | null {
  const text = String(raw || '').trim()
  if (!count) return []
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced?.[1] || text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(body.slice(start, end + 1))
  } catch {
    return null
  }
  const lines = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as { lines?: unknown }).lines
    : null
  if (!Array.isArray(lines) || lines.length !== count) return null
  const out = lines.map((item) => String(item ?? '').trim())
  if (out.some((item) => !item)) return null
  return out
}

export async function rewritePromptSpokenLines(
  prompt: string,
  languageCode: string,
  complete: (instruction: string, lines: string[]) => Promise<string> = completeSpokenRewrite,
): Promise<string> {
  const originals = extractSpokenLines(prompt).map((line) => line.text)
  if (!originals.length) return prompt
  try {
    const raw = await complete(spokenLineRewriteInstruction(languageCode), originals)
    const rewritten = parseSpokenRewrite(raw, originals.length)
    if (!rewritten) {
      logTaskWarn('VideoTask', 'spoken-rewrite-skip', {
        language: languageCode,
        lines: originals.length,
        reason: 'unparsed',
      })
      return prompt
    }
    return substituteSpokenLines(prompt, rewritten)
  } catch (err) {
    logTaskWarn('VideoTask', 'spoken-rewrite-skip', {
      language: languageCode,
      lines: originals.length,
      error: String((err as Error)?.message || err || 'rewrite failed'),
    })
    return prompt
  }
}

async function completeSpokenRewrite(instruction: string, lines: string[]): Promise<string> {
  const { getTextConfig } = await import('../ai.js')
  const config = await getTextConfig()
  const provider = config.provider.toLowerCase()
  if (provider === 'gemini') return completeGemini(config, instruction, lines)
  return completeChat(config, instruction, lines)
}

async function completeChat(
  config: { provider: string; baseUrl: string; apiKey: string; model: string },
  instruction: string,
  lines: string[],
): Promise<string> {
  const { getTextProviderBaseUrl } = await import('../ai.js')
  const { joinProviderUrl } = await import('../adapters/url.js')
  const url = joinProviderUrl(getTextProviderBaseUrl(config), '', '/chat/completions')
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: instruction },
        { role: 'user', content: JSON.stringify({ lines }) },
      ],
    }),
    signal: AbortSignal.timeout(REWRITE_TIMEOUT_MS),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const message = json?.error?.message || json?.message || `HTTP ${res.status}`
    throw new Error(String(message))
  }
  const content = json?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('')
  }
  throw new Error('empty spoken rewrite')
}

async function completeGemini(
  config: { baseUrl: string; apiKey: string; model: string },
  instruction: string,
  lines: string[],
): Promise<string> {
  const { applyGeminiAuth, normalizeGeminiBaseUrl, unwrapGeminiProxyPayload } = await import('../adapters/gemini-auth.js')
  const { joinProviderUrl } = await import('../adapters/url.js')
  const url = new URL(joinProviderUrl(
    normalizeGeminiBaseUrl(config.baseUrl),
    '/v1beta',
    `/${config.model}:generateContent`,
  ))
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  applyGeminiAuth(url, headers, config.baseUrl, config.apiKey)
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{ text: `${instruction}\n\n${JSON.stringify({ lines })}` }],
      }],
      generationConfig: { temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(REWRITE_TIMEOUT_MS),
  })
  const json = unwrapGeminiProxyPayload(await res.json().catch(() => null))
  if (!res.ok) {
    const message = json?.error?.message || `HTTP ${res.status}`
    throw new Error(String(message))
  }
  const parts = json?.candidates?.[0]?.content?.parts
  const text = Array.isArray(parts)
    ? parts.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('')
    : ''
  if (!text.trim()) throw new Error('empty spoken rewrite')
  return text
}

/**
 * Gemini auth + payload helpers.
 *
 * Official Google uses `?key=` / `x-goog-api-key`.
 * Proxies such as APIMart use native `/v1beta/models/{model}:generateContent`
 * with `Authorization: Bearer` and may wrap the body as `{ code, data }`.
 */

export function isOfficialGeminiHost(baseUrl: string) {
  return /generativelanguage\.googleapis\.com/.test(baseUrl || '')
}

/** Drop a trailing `/v1` so APIMart `GEMINI_BASE_URL=.../v1` still hits `/v1beta`. */
export function normalizeGeminiBaseUrl(baseUrl: string) {
  return (baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/i, '')
}

export function applyGeminiAuth(
  url: URL,
  headers: Record<string, string>,
  baseUrl: string,
  apiKey: string,
) {
  if (!apiKey) return
  if (isOfficialGeminiHost(baseUrl)) {
    url.searchParams.set('key', apiKey)
    headers['x-goog-api-key'] = apiKey
    return
  }
  url.searchParams.delete('key')
  delete headers['x-goog-api-key']
  headers.Authorization = `Bearer ${apiKey}`
}

export function unwrapGeminiProxyPayload(result: any): any {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result
  const inner = result.data
  if (
    inner
    && typeof inner === 'object'
    && !Array.isArray(inner)
    && result.candidates == null
    && (inner.candidates || inner.usageMetadata || inner.promptFeedback)
  ) {
    return inner
  }
  return result
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function stripKeyParam(raw: string) {
  try {
    const url = new URL(raw)
    url.searchParams.delete('key')
    return url.toString()
  } catch {
    return raw
  }
}

function isStreamingContentType(contentType: string) {
  const value = contentType.toLowerCase()
  return value.includes('text/event-stream') || value.includes('octet-stream')
}

/**
 * Force Bearer auth and unwrap `{ code, data }` so @ai-sdk/google can parse
 * APIMart's native Gemini responses.
 */
export function createGeminiProxyFetch(apiKey: string, inner?: typeof fetch): typeof fetch {
  const base = inner || fetch
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = stripKeyParam(requestUrl(input))
    const headers = new Headers(
      init?.headers
      || (input instanceof Request ? input.headers : undefined),
    )
    headers.delete('x-goog-api-key')
    if (apiKey) headers.set('Authorization', `Bearer ${apiKey}`)

    const nextInit: RequestInit = { ...init, headers }
    const res = await base(url, nextInit)
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('json') || isStreamingContentType(contentType)) {
      return res
    }

    const json = await res.json()
    const payload = unwrapGeminiProxyPayload(json)
    return new Response(JSON.stringify(payload), {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    })
  }
}

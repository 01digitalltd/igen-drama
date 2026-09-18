/** Map wizard / BFF / local still URLs onto drama storage relative paths. */
export function toLocalStaticPath(value: string): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  let pathOnly = raw.split('?')[0]
  try {
    if (/^https?:\/\//i.test(raw)) pathOnly = new URL(raw).pathname
  } catch {
    /* keep pathOnly */
  }
  const stripped = pathOnly.replace(/^\/api\/drama(?=\/static\/)/, '')
  if (stripped.startsWith('/static/')) return stripped.slice(1)
  if (stripped.startsWith('static/')) return stripped
  return null
}

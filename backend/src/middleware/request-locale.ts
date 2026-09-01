import type { Context, MiddlewareHandler } from 'hono'
import { normalizeContentLocale, type ContentLocale } from '../utils/content-language.js'

export const LOCALE_HEADER = 'x-locale'

export const requestLocale: MiddlewareHandler = async (c, next) => {
  const raw = c.req.header(LOCALE_HEADER) || c.req.header('accept-language') || ''
  c.set('locale', normalizeContentLocale(raw))
  await next()
}

export function getRequestLocale(c: Context, bodyLocale?: unknown): ContentLocale {
  if (typeof bodyLocale === 'string' && bodyLocale.trim()) {
    return normalizeContentLocale(bodyLocale)
  }
  return (c.get('locale') as ContentLocale) || 'zh-TW'
}

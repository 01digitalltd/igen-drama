import type { MiddlewareHandler } from 'hono'
import { unauthorized } from '../utils/response.js'

export const OWNER_USER_HEADER = 'x-drama-owner-user-id'
export const OWNER_TENANT_HEADER = 'x-drama-owner-tenant-id'
export const IMPERSONATOR_HEADER = 'x-drama-impersonator-id'
export const SERVICE_KEY_HEADER = 'x-drama-service-key'

export function getConfiguredServiceKey(): string {
  return (process.env.DRAMA_SERVICE_KEY || '').trim()
}

/** When unset, local Nuxt keeps working with no auth (dev). Production must set the key. */
export function isServiceAuthEnabled(): boolean {
  return Boolean(getConfiguredServiceKey())
}

export const serviceAuth: MiddlewareHandler = async (c, next) => {
  const expected = getConfiguredServiceKey()
  if (!expected) {
    c.set('ownerUserId', null)
    c.set('ownerTenantId', null)
    c.set('impersonatorId', null)
    await next()
    return
  }

  const provided = (c.req.header(SERVICE_KEY_HEADER) || '').trim()
  if (!provided || provided !== expected) {
    return unauthorized(c, 'invalid service key')
  }

  const ownerUserId = (c.req.header(OWNER_USER_HEADER) || '').trim() || null
  const ownerTenantId = (c.req.header(OWNER_TENANT_HEADER) || '').trim() || null
  const impersonatorId = (c.req.header(IMPERSONATOR_HEADER) || '').trim() || null
  c.set('ownerUserId', ownerUserId)
  c.set('ownerTenantId', ownerTenantId)
  c.set('impersonatorId', impersonatorId)
  if (impersonatorId) {
    console.info('[drama-auth] impersonation', {
      ownerUserId,
      ownerTenantId,
      impersonatorId,
      path: c.req.path,
      method: c.req.method,
    })
  }
  await next()
}

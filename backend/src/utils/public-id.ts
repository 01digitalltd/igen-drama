import { randomUUID } from 'node:crypto'
import { toSnakeCase } from './transform.js'

/** RFC 4122 UUID (any version). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type PublicIdRow = {
  id: number
  uuid?: string | null
}

export function newPublicUuid(): string {
  return randomUUID()
}

export function isPublicUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim())
}

export function parseNumericId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || isPublicUuid(trimmed) || !/^\d+$/.test(trimmed)) return null
  const n = Number(trimmed)
  return Number.isInteger(n) && n > 0 ? n : null
}

export function normalizePublicUuid(value: string): string {
  return value.trim().toLowerCase()
}

/** Public API / URL id: uuid when present, otherwise the numeric pk as a string. */
export function publicId(row: PublicIdRow): string {
  if (row.uuid && isPublicUuid(row.uuid)) return normalizePublicUuid(row.uuid)
  return String(row.id)
}

export function toPublicDrama<T extends PublicIdRow>(row: T, extra: Record<string, unknown> = {}) {
  const body = toSnakeCase(row as Record<string, unknown>)
  delete body.uuid
  return { ...body, id: publicId(row), ...extra }
}

export function toPublicEpisode<T extends PublicIdRow & { dramaId?: number }>(
  row: T,
  drama: PublicIdRow,
  extra: Record<string, unknown> = {},
) {
  const body = toSnakeCase(row as Record<string, unknown>)
  delete body.uuid
  return { ...body, id: publicId(row), drama_id: publicId(drama), ...extra }
}

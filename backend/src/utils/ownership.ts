import type { Context } from 'hono'
import { and, eq, isNull } from '../db/query.js'
import { db, schema } from '../db/index.js'
import { isServiceAuthEnabled } from '../middleware/service-auth.js'

export function getOwnerUserId(c: Context): string | null {
  return (c.get('ownerUserId') as string | null | undefined) || null
}

export function getOwnerTenantId(c: Context): string | null {
  return (c.get('ownerTenantId') as string | null | undefined) || null
}

/** Tenant isolation is on when a service key is configured AND the caller sent an owner id. */
export function shouldScopeToOwner(c: Context): boolean {
  return isServiceAuthEnabled() && Boolean(getOwnerUserId(c))
}

export class OwnershipError extends Error {
  status: number
  constructor(message: string, status = 404) {
    super(message)
    this.status = status
  }
}

function denyMissing(): never {
  throw new OwnershipError('剧本不存在', 404)
}

export async function loadOwnedDrama(c: Context, dramaId: number) {
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  if (!drama || drama.deletedAt) denyMissing()
  if (shouldScopeToOwner(c)) {
    const owner = getOwnerUserId(c)
    if (!drama.ownerUserId || drama.ownerUserId !== owner) denyMissing()
  }
  return drama
}

export async function loadOwnedEpisode(c: Context, episodeId: number) {
  const [episode] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  if (!episode || episode.deletedAt) {
    throw new OwnershipError('剧集不存在', 404)
  }
  await loadOwnedDrama(c, episode.dramaId)
  return episode
}

export async function loadOwnedCharacter(c: Context, characterId: number) {
  const [row] = await db.select().from(schema.characters).where(eq(schema.characters.id, characterId))
  if (!row || row.deletedAt) throw new OwnershipError('角色不存在', 404)
  await loadOwnedDrama(c, row.dramaId)
  return row
}

export async function loadOwnedScene(c: Context, sceneId: number) {
  const [row] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, sceneId))
  if (!row || row.deletedAt) throw new OwnershipError('场景不存在', 404)
  await loadOwnedDrama(c, row.dramaId)
  return row
}

export async function loadOwnedProp(c: Context, propId: number) {
  const [row] = await db.select().from(schema.props).where(eq(schema.props.id, propId))
  if (!row || row.deletedAt) throw new OwnershipError('道具不存在', 404)
  await loadOwnedDrama(c, row.dramaId)
  return row
}

export async function loadOwnedStoryboard(c: Context, storyboardId: number) {
  const [row] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboardId))
  if (!row || row.deletedAt) throw new OwnershipError('分镜不存在', 404)
  await loadOwnedEpisode(c, row.episodeId)
  return row
}

export function ownerDramaWhere(c: Context) {
  const clauses = [isNull(schema.dramas.deletedAt)]
  if (shouldScopeToOwner(c)) {
    clauses.push(eq(schema.dramas.ownerUserId, getOwnerUserId(c)!))
  }
  return and(...clauses)
}

import { db, getInsertId, schema } from '../db/index.js'
import { and, eq } from '../db/query.js'
import { now } from '../utils/response.js'
import {
  BRAND_LOGO_PROP_NAME,
  BRAND_LOGO_PROP_TYPE,
  isAdPromoCategory,
  isBrandLogoProp,
  normalizeProjectCategory,
  type ProjectCategory,
} from '../utils/project-category.js'
import { adContextFields, taxonomyFromMetadata, type AdTaxonomy } from '../utils/ad-taxonomy.js'
import {
  appendBrandLogoDirective,
  logoPlacementFromMetadata,
  logoPlacementInstruction,
  mergeLogoPlacementMetadata,
  normalizeLogoPlacement,
  shotNeedsBrandLogo,
  LOGO_PLACEMENT_ALL,
  LOGO_PLACEMENT_END,
  type LogoPlacement,
} from './brand-logo-placement.js'

export {
  appendBrandLogoDirective,
  logoPlacementFromMetadata,
  logoPlacementInstruction,
  mergeLogoPlacementMetadata,
  normalizeLogoPlacement,
  shotNeedsBrandLogo,
  LOGO_PLACEMENT_ALL,
  LOGO_PLACEMENT_END,
}
export type { LogoPlacement }

export type DramaAdContext = {
  genre: ProjectCategory
  spec: AdTaxonomy | null
}

export async function loadDramaAdContext(dramaId: number): Promise<DramaAdContext> {
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  const genre = normalizeProjectCategory(drama?.genre)
  if (!isAdPromoCategory(genre)) return { genre, spec: null }
  return { genre, spec: taxonomyFromMetadata(drama?.metadata) }
}

export async function loadDramaCategory(dramaId: number): Promise<ProjectCategory> {
  return (await loadDramaAdContext(dramaId)).genre
}

export function dramaAdFields(ctx: DramaAdContext) {
  return adContextFields(ctx.spec, ctx.genre)
}

export function agentContextFromAd(ctx: DramaAdContext) {
  return {
    genre: ctx.genre,
    adPurpose: ctx.spec?.purpose,
    adForm: ctx.spec?.form,
    adAngle: ctx.spec?.angle,
  }
}

async function linkPropToEpisode(episodeId: number, propId: number) {
  const ts = now()
  const existing = await db.select().from(schema.episodeProps)
    .where(and(eq(schema.episodeProps.episodeId, episodeId), eq(schema.episodeProps.propId, propId)))
  if (!existing.length) {
    await db.insert(schema.episodeProps).values({ episodeId, propId, createdAt: ts })
  }
}

export async function findBrandLogoProp(dramaId: number) {
  const rows = (await db.select().from(schema.props).where(eq(schema.props.dramaId, dramaId)))
    .filter(row => !row.deletedAt)
  return rows.find(row => isBrandLogoProp(row)) || null
}

/** Ensure the ad project has a Logo prop slot. Never invent artwork — image must be uploaded. */
export async function ensureBrandLogoProp(dramaId: number, episodeId?: number | null) {
  let logo = await findBrandLogoProp(dramaId)
  const ts = now()
  if (!logo) {
    const res = await db.insert(schema.props).values({
      name: BRAND_LOGO_PROP_NAME,
      type: BRAND_LOGO_PROP_TYPE,
      description: '公司官方商标原件。必须使用用户上传的 Logo 文件，禁止 AI 生成或重绘。',
      dramaId,
      createdAt: ts,
      updatedAt: ts,
    })
    const [row] = await db.select().from(schema.props).where(eq(schema.props.id, getInsertId(res)))
    logo = row || null
  }
  if (episodeId && logo) await linkPropToEpisode(episodeId, logo.id)
  return logo
}

export async function brandLogoPropIfNeeded(dramaId: number, shot: {
  episodeId: number
  storyboardNumber?: number | null
}) {
  const logo = await findBrandLogoProp(dramaId)
  const url = String(logo?.imageUrl || logo?.localPath || '').trim()
  if (!logo || !url) return null
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  const rows = (await db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, shot.episodeId)))
    .filter((row) => !row.deletedAt)
  const maxNo = Math.max(0, ...rows.map((row) => Number(row.storyboardNumber) || 0))
  if (!shotNeedsBrandLogo(logoPlacementFromMetadata(drama?.metadata), shot.storyboardNumber, maxNo)) {
    return null
  }
  return logo
}

export async function applyBrandLogoPlacement(dramaId: number, episodeId?: number) {
  const logo = await findBrandLogoProp(dramaId)
  if (!logo) return
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  const placement = logoPlacementFromMetadata(drama?.metadata)
  const episodes = episodeId
    ? [{ id: episodeId, deletedAt: null as string | null }]
    : await db.select().from(schema.episodes).where(eq(schema.episodes.dramaId, dramaId))
  for (const episode of episodes) {
    if (episode.deletedAt) continue
    const rows = (await db.select().from(schema.storyboards)
      .where(eq(schema.storyboards.episodeId, episode.id)))
      .filter((row) => !row.deletedAt)
    const maxNo = Math.max(0, ...rows.map((row) => Number(row.storyboardNumber) || 0))
    for (const row of rows) {
      const want = shotNeedsBrandLogo(placement, row.storyboardNumber, maxNo)
      const links = await db.select().from(schema.storyboardProps)
        .where(eq(schema.storyboardProps.storyboardId, row.id))
      const has = links.some((link) => Number(link.propId) === logo.id)
      if (want && !has) {
        await db.insert(schema.storyboardProps).values({ storyboardId: row.id, propId: logo.id })
      } else if (!want && has) {
        await db.delete(schema.storyboardProps).where(and(
          eq(schema.storyboardProps.storyboardId, row.id),
          eq(schema.storyboardProps.propId, logo.id),
        ))
      }
    }
  }
}

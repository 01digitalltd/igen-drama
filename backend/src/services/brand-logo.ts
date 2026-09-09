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

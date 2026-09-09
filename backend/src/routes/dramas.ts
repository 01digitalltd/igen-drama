import { Hono } from 'hono'
import { and, eq, isNull, desc } from '../db/query.js'
import { db, getInsertId, schema } from '../db/index.js'
import { success, badRequest, created, now } from '../utils/response.js'
import { toSnakeCaseArray } from '../utils/transform.js'
import { getOwnerTenantId, getOwnerUserId, loadOwnedDrama, loadOwnedEpisode, ownerDramaWhere, ensureDramaUuid, ensureEpisodeUuid } from '../utils/ownership.js'
import { toPublicDrama, toPublicEpisode } from '../utils/public-id.js'
import { defaultDialogueLanguageFromLocale, normalizeDialogueLanguage } from '../services/dialogue-language.js'
import { DEFAULT_VO_VOICE, normalizeVoVoice } from '../services/vo-voice.js'
import { defaultAspectRatioForCategory, normalizeProjectCategory, isAdPromoCategory } from '../utils/project-category.js'
import { mergeAdTaxonomyMetadata, normalizeAdTaxonomy, adContextFields, taxonomyFromMetadata } from '../utils/ad-taxonomy.js'
import { ensureBrandLogoProp } from '../services/brand-logo.js'
import type { DramaRow } from '../db/schema.js'

const app = new Hono()

function serializeMetadata(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

function enrichDrama(drama: DramaRow, extra: Record<string, unknown> = {}) {
  const genre = normalizeProjectCategory(drama.genre)
  const spec = isAdPromoCategory(genre) ? taxonomyFromMetadata(drama.metadata) : null
  return {
    ...toPublicDrama(drama),
    tags: drama.tags ? JSON.parse(drama.tags) : [],
    ...adContextFields(spec, genre),
    ...extra,
  }
}

// GET /dramas - List dramas
app.get('/', async (c) => {
  const page = Number(c.req.query('page') || 1)
  const pageSize = Number(c.req.query('page_size') || 20)
  const status = c.req.query('status')
  const keyword = c.req.query('keyword')

  const allRows = await db.select().from(schema.dramas)
    .where(ownerDramaWhere(c))
    .orderBy(desc(schema.dramas.updatedAt))
  let filtered = allRows

  if (status) filtered = filtered.filter(d => d.status === status)
  if (keyword) filtered = filtered.filter(d => d.title.includes(keyword))

  const total = filtered.length
  const items = filtered.slice((page - 1) * pageSize, page * pageSize)

  const enriched = await Promise.all(items.map(async (item) => {
    const drama = await ensureDramaUuid(item)
    const eps = await db.select().from(schema.episodes)
      .where(and(eq(schema.episodes.dramaId, drama.id), isNull(schema.episodes.deletedAt)))
    const publicEps = await Promise.all(eps.map((ep) => ensureEpisodeUuid(ep)))
    const chars = await db.select().from(schema.characters)
      .where(eq(schema.characters.dramaId, drama.id))
    const scns = await db.select().from(schema.scenes)
      .where(eq(schema.scenes.dramaId, drama.id))
    return {
      ...enrichDrama(drama),
      total_episodes: eps.length,
      episodes: publicEps.map((ep) => toPublicEpisode(ep, drama)),
      characters: toSnakeCaseArray(chars),
      scenes: toSnakeCaseArray(scns),
    }
  }))

  return success(c, {
    items: enriched,
    pagination: { page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) },
  })
})

// POST /dramas - Create drama
app.post('/', async (c) => {
  const body = await c.req.json()
  if (!body.title?.trim()) return badRequest(c, 'title required')
  const ts = now()
  const genre = normalizeProjectCategory(body.genre)
  const metadata = isAdPromoCategory(genre)
    ? mergeAdTaxonomyMetadata(body.metadata, normalizeAdTaxonomy(body))
    : serializeMetadata(body.metadata)
  const res = await db.insert(schema.dramas).values({
    title: body.title,
    description: body.description,
    genre,
    style: body.style,
    aspectRatio: body.aspect_ratio || defaultAspectRatioForCategory(genre),
    dialogueLanguage: normalizeDialogueLanguage(
      body.dialogue_language || body.dialogueLanguage || defaultDialogueLanguageFromLocale(body.locale),
    ),
    voVoice: normalizeVoVoice(body.vo_voice || body.voVoice || DEFAULT_VO_VOICE),
    tags: body.tags ? JSON.stringify(body.tags) : null,
    metadata,
    ownerUserId: getOwnerUserId(c),
    ownerTenantId: getOwnerTenantId(c),
    status: 'draft',
    createdAt: ts,
    updatedAt: ts,
  })

  const [result] = await db.select().from(schema.dramas)
    .where(eq(schema.dramas.id, getInsertId(res)))
  const createdDrama = result ? await ensureDramaUuid(result) : result

  if (isAdPromoCategory(createdDrama?.genre)) {
    await ensureBrandLogoProp(createdDrama.id)
  }

  return created(c, enrichDrama(createdDrama))
})


// GET /dramas/stats — must be before /:id
app.get('/stats', async (c) => {
  const all = await db.select().from(schema.dramas).where(ownerDramaWhere(c))
  const byStatus = Object.entries(
    all.reduce((acc, d) => {
      acc[d.status || 'draft'] = (acc[d.status || 'draft'] || 0) + 1
      return acc
    }, {} as Record<string, number>)
  ).map(([status, count]) => ({ status, count }))
  return success(c, { total: all.length, by_status: byStatus })
})

// GET /dramas/:id - Get drama detail
app.get('/:id', async (c) => {
  const drama = await loadOwnedDrama(c, c.req.param('id'))
  const id = drama.id

  const eps = await db.select().from(schema.episodes)
    .where(and(eq(schema.episodes.dramaId, id), isNull(schema.episodes.deletedAt)))
  const publicEps = await Promise.all(eps.map((ep) => ensureEpisodeUuid(ep)))
  const chars = await db.select().from(schema.characters)
    .where(eq(schema.characters.dramaId, id))
  const scns = await db.select().from(schema.scenes)
    .where(eq(schema.scenes.dramaId, id))
  const prps = await db.select().from(schema.props)
    .where(eq(schema.props.dramaId, id))

  return success(c, {
    ...enrichDrama(drama),
    episodes: publicEps.map((ep) => toPublicEpisode(ep, drama)),
    characters: toSnakeCaseArray(chars),
    scenes: toSnakeCaseArray(scns),
    props: toSnakeCaseArray(prps),
  })
})

// PUT /dramas/:id - Update drama
app.put('/:id', async (c) => {
  const drama = await loadOwnedDrama(c, c.req.param('id'))
  const id = drama.id
  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }
  if (body.title !== undefined) updates.title = body.title
  if (body.description !== undefined) updates.description = body.description
  if (body.genre !== undefined) updates.genre = normalizeProjectCategory(body.genre)
  if (body.style !== undefined) updates.style = body.style
  if (body.aspect_ratio !== undefined) updates.aspectRatio = body.aspect_ratio
  if (body.dialogue_language !== undefined || body.dialogueLanguage !== undefined) {
    updates.dialogueLanguage = normalizeDialogueLanguage(body.dialogue_language ?? body.dialogueLanguage)
  }
  if (body.vo_voice !== undefined || body.voVoice !== undefined) {
    updates.voVoice = normalizeVoVoice(body.vo_voice ?? body.voVoice)
  }
  if (body.status !== undefined) updates.status = body.status
  if (body.tags !== undefined) updates.tags = JSON.stringify(body.tags)
  const nextGenre = updates.genre ?? drama.genre
  if (
    body.metadata !== undefined ||
    body.ad_purpose !== undefined ||
    body.ad_form !== undefined ||
    body.ad_angle !== undefined ||
    body.genre !== undefined
  ) {
    if (isAdPromoCategory(nextGenre)) {
      const current = taxonomyFromMetadata(updates.metadata ?? drama.metadata)
      updates.metadata = mergeAdTaxonomyMetadata(updates.metadata ?? drama.metadata, normalizeAdTaxonomy({
        ...current,
        purpose: body.ad_purpose ?? current.purpose,
        form: body.ad_form ?? current.form,
        angle: body.ad_angle ?? current.angle,
      }))
    } else if (body.metadata !== undefined) {
      updates.metadata = serializeMetadata(body.metadata)
    }
  }
  await db.update(schema.dramas).set(updates).where(eq(schema.dramas.id, id))
  if (updates.genre && isAdPromoCategory(updates.genre)) {
    await ensureBrandLogoProp(id)
  }
  return success(c)
})

// DELETE /dramas/:id - Soft delete
app.delete('/:id', async (c) => {
  const drama = await loadOwnedDrama(c, c.req.param('id'))
  await db.update(schema.dramas).set({ deletedAt: now() }).where(eq(schema.dramas.id, drama.id))
  return success(c)
})

// PUT /dramas/:id/characters - Save characters
app.put('/:id/characters', async (c) => {
  const drama = await loadOwnedDrama(c, c.req.param('id'))
  const dramaId = drama.id
  const body = await c.req.json()
  const chars = body.characters || []
  const ts = now()

  for (const char of chars) {
    if (char.id) {
      await db.update(schema.characters).set({ ...char, updatedAt: ts }).where(eq(schema.characters.id, char.id))
    } else {
      await db.insert(schema.characters).values({ ...char, dramaId, createdAt: ts, updatedAt: ts })
    }
  }
  return success(c)
})

// PUT /dramas/:id/episodes - Save episodes
app.put('/:id/episodes', async (c) => {
  const drama = await loadOwnedDrama(c, c.req.param('id'))
  const dramaId = drama.id
  const body = await c.req.json()
  const episodes = body.episodes || []
  const ts = now()

  for (const ep of episodes) {
    if (ep.id) {
      const existing = await loadOwnedEpisode(c, ep.id)
      await db.update(schema.episodes).set({ ...ep, id: existing.id, uuid: existing.uuid, dramaId, updatedAt: ts }).where(eq(schema.episodes.id, existing.id))
    } else {
      await db.insert(schema.episodes).values({
        ...ep,
        dramaId,
        episodeNumber: ep.episode_number || ep.episodeNumber || 1,
        title: ep.title || '未命名',
        createdAt: ts,
        updatedAt: ts,
      })
    }
  }
  return success(c)
})

export default app

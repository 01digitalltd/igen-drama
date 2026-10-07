/**
 * Switch an ad project to the Vlog form before rewrite, extract, or storyboard
 * load their skills.
 */
import { db, schema } from '../db/index.js'
import { eq } from '../db/query.js'
import { now } from '../utils/response.js'
import { isAdPromoCategory } from '../utils/project-category.js'
import { isAdFormUserLocked, mergeAdTaxonomyMetadata } from '../utils/ad-taxonomy.js'
import { loadDramaAdContext, type DramaAdContext } from './brand-logo.js'
import { hostVlogTaxonomy } from './vlog-form-detect.js'

export { hostVlogTaxonomy, looksLikeHostVlog } from './vlog-form-detect.js'

export async function applyHostVlogForm(dramaId: number, episodeId: number): Promise<DramaAdContext> {
  const ad = await loadDramaAdContext(dramaId)
  if (!isAdPromoCategory(ad.genre) || !ad.spec) return ad
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  if (isAdFormUserLocked(drama?.metadata)) return ad
  const [episode] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  const text = [episode?.content, episode?.scriptContent].filter(Boolean).join('\n')
  const next = hostVlogTaxonomy(ad.spec, text)
  if (!next) return ad
  await db.update(schema.dramas)
    .set({ metadata: mergeAdTaxonomyMetadata(drama?.metadata, next), updatedAt: now() })
    .where(eq(schema.dramas.id, dramaId))
  return { genre: ad.genre, spec: next }
}

/**
 * Drop this episode's extracted assets before a fresh extract.
 * A brand logo prop stays linked. Assets still used by another episode are only unlinked here.
 */
import { db, schema } from '../db/index.js'
import { and, eq } from '../db/query.js'
import { now } from '../utils/response.js'
import { isBrandLogoProp } from '../utils/project-category.js'
import { idsToRetire } from './episode-asset-clear-plan.js'

export { idsToRetire } from './episode-asset-clear-plan.js'

async function unlink(table: typeof schema.episodeCharacters | typeof schema.episodeScenes | typeof schema.episodeProps, episodeId: number, column: 'characterId' | 'sceneId' | 'propId', ids: number[]) {
  for (const id of ids) {
    await db.delete(table).where(and(eq(table.episodeId, episodeId), eq(table[column], id)))
  }
}

export async function clearEpisodeAssets(episodeId: number) {
  const [charLinks, sceneLinks, propLinks, props] = await Promise.all([
    db.select().from(schema.episodeCharacters),
    db.select().from(schema.episodeScenes),
    db.select().from(schema.episodeProps),
    db.select().from(schema.props),
  ])
  const logoIds = props.filter((row) => isBrandLogoProp(row) && !row.deletedAt).map((row) => row.id)
  const characters = idsToRetire(episodeId, charLinks.map((row) => ({ episodeId: row.episodeId, assetId: row.characterId })))
  const scenes = idsToRetire(episodeId, sceneLinks.map((row) => ({ episodeId: row.episodeId, assetId: row.sceneId })))
  const propPlan = idsToRetire(episodeId, propLinks.map((row) => ({ episodeId: row.episodeId, assetId: row.propId })), logoIds)
  const ts = now()

  await unlink(schema.episodeCharacters, episodeId, 'characterId', characters.unlink)
  await unlink(schema.episodeScenes, episodeId, 'sceneId', scenes.unlink)
  await unlink(schema.episodeProps, episodeId, 'propId', propPlan.unlink)

  for (const id of characters.remove) {
    await db.delete(schema.storyboardCharacters).where(eq(schema.storyboardCharacters.characterId, id))
    await db.update(schema.characters).set({ deletedAt: ts, updatedAt: ts }).where(eq(schema.characters.id, id))
  }
  for (const id of scenes.remove) {
    const boards = await db.select().from(schema.storyboards).where(eq(schema.storyboards.sceneId, id))
    for (const board of boards) {
      await db.update(schema.storyboards).set({ sceneId: null, updatedAt: ts }).where(eq(schema.storyboards.id, board.id))
    }
    await db.update(schema.scenes).set({ deletedAt: ts, updatedAt: ts }).where(eq(schema.scenes.id, id))
  }
  for (const id of propPlan.remove) {
    await db.delete(schema.storyboardProps).where(eq(schema.storyboardProps.propId, id))
    await db.update(schema.props).set({ deletedAt: ts, updatedAt: ts }).where(eq(schema.props.id, id))
  }

  return {
    characters: characters.remove.length,
    scenes: scenes.remove.length,
    props: propPlan.remove.length,
    kept_logo: logoIds.length,
  }
}

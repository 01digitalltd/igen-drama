/** Which episode asset links to drop, and which rows are safe to retire. */

type EpisodeLink = { episodeId: number; assetId: number }

export function idsToRetire(episodeId: number, links: EpisodeLink[], keepIds: number[] = []) {
  const keep = new Set(keepIds)
  const unlink = [...new Set(
    links.filter((link) => link.episodeId === episodeId && !keep.has(link.assetId)).map((link) => link.assetId),
  )]
  const remove = unlink.filter((id) => !links.some((link) => link.assetId === id && link.episodeId !== episodeId))
  return { unlink, remove }
}

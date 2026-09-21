import { eq } from '../db/query.js'
import { db, schema } from '../db/index.js'
import { scriptSnippetsForName } from './script-excerpt-text.js'

export { characterNameAliases, scriptSnippetsForName } from './script-excerpt-text.js'

export async function loadEpisodeScripts(episodeId: number): Promise<{ formatted: string; original: string; script: string }> {
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  const original = String(ep?.content || '').trim()
  const formatted = String(ep?.scriptContent || '').trim()
  return { formatted, original, script: formatted || original }
}

export async function characterScriptExcerpt(episodeId: number, name: string, limit = 2800): Promise<string> {
  const { formatted, original, script } = await loadEpisodeScripts(episodeId)
  const fromFormatted = scriptSnippetsForName(formatted || script, name, limit)
  if (!original || original === (formatted || script)) return fromFormatted
  const remaining = Math.max(400, limit - fromFormatted.length - 20)
  const fromOriginal = scriptSnippetsForName(original, name, remaining)
  if (!fromOriginal || fromFormatted.includes(fromOriginal)) return fromFormatted
  if (!fromFormatted) return fromOriginal
  return `${fromFormatted}\n\n${fromOriginal}`.slice(0, limit)
}

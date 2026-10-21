/**
 * Settle a finished drama image or video even if the browser already left.
 * Billing failures are logged and never fail the completed asset.
 */
import { db, schema } from '../db/index.js'
import { eq } from '../db/query.js'
import { logTaskWarn } from '../utils/task-logger.js'
import { dramaBillingTarget, type DramaBillingTask } from './token-billing-target.js'

const MONGO_ID = /^[a-f0-9]{24}$/i

export async function billCompletedDramaTask(record: DramaBillingTask): Promise<void> {
  try {
    const target = dramaBillingTarget(record)
    if (!target) return
    const userId = await ownerUserId(record)
    if (!userId || !MONGO_ID.test(userId)) return
    await postSettle({ userId, ...target })
  } catch (error) {
    logTaskWarn('TokenBilling', 'settle-failed', {
      id: record.id,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

async function ownerUserId(record: DramaBillingTask): Promise<string | null> {
  const direct = await dramaOwner(record)
  if (direct) return direct
  const shot = Number(record.storyboardId)
  if (!Number.isFinite(shot) || shot <= 0) return null
  const [storyboard] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, shot))
  if (!storyboard) return null
  const [episode] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, storyboard.episodeId))
  if (!episode) return null
  return dramaOwnerById(episode.dramaId)
}

async function dramaOwner(record: DramaBillingTask): Promise<string | null> {
  const dramaId = Number((record as { dramaId?: number | null }).dramaId)
  if (Number.isFinite(dramaId) && dramaId > 0) return dramaOwnerById(dramaId)
  const characterId = Number(record.characterId)
  if (Number.isFinite(characterId) && characterId > 0) {
    const [row] = await db.select().from(schema.characters).where(eq(schema.characters.id, characterId))
    if (row) return dramaOwnerById(row.dramaId)
  }
  const sceneId = Number(record.sceneId)
  if (Number.isFinite(sceneId) && sceneId > 0) {
    const [row] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, sceneId))
    if (row) return dramaOwnerById(row.dramaId)
  }
  const propId = Number(record.propId)
  if (Number.isFinite(propId) && propId > 0) {
    const [row] = await db.select().from(schema.props).where(eq(schema.props.id, propId))
    if (row) return dramaOwnerById(row.dramaId)
  }
  return null
}

async function dramaOwnerById(dramaId: number): Promise<string | null> {
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  const owner = String(drama?.ownerUserId || '').trim()
  return owner || null
}

function mktBaseUrl(): string {
  const raw = process.env.MKT_AI_INTERNAL_BASE_URL || process.env.MKT_AI_BASE_URL || 'http://127.0.0.1:3001/mkt-ai'
  return raw.replace(/\/$/, '')
}

function serviceKey(): string {
  return String(process.env.DRAMA_TO_MKT_SERVICE_KEY || process.env.DRAMA_SERVICE_KEY || '').trim()
}

async function postSettle(body: { userId: string, serviceName: string, recordId: string, videoSeconds?: number }) {
  const key = serviceKey()
  if (!key) {
    logTaskWarn('TokenBilling', 'service-key-missing', { recordId: body.recordId })
    return
  }
  const response = await fetch(`${mktBaseUrl()}/internal/drama/settle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-drama-service-key': key,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`settle ${response.status} ${text.slice(0, 200)}`)
  }
}

/**
 * Seed platform AI configs from env when none are active.
 * Customers never see the drama settings page; ops inject keys here.
 */
import { db, schema } from '../db/index.js'
import { eq } from '../db/query.js'
import { now } from '../utils/response.js'
import { officialProviders, type ServiceType } from './ai.js'

interface SeedSpec {
  serviceType: ServiceType
  envPrefix: string
}

const SPECS: SeedSpec[] = [
  { serviceType: 'text', envPrefix: 'DRAMA_TEXT' },
  { serviceType: 'image', envPrefix: 'DRAMA_IMAGE' },
  { serviceType: 'video', envPrefix: 'DRAMA_VIDEO' },
]

function readEnv(prefix: string, key: string): string {
  return (process.env[`${prefix}_${key}`] || '').trim()
}

export async function seedAiConfigsFromEnv() {
  const ts = now()
  for (const spec of SPECS) {
    const existing = (await db.select().from(schema.aiServiceConfigs)
      .where(eq(schema.aiServiceConfigs.serviceType, spec.serviceType)))
      .filter((r) => r.isActive)
    if (existing.length) continue

    const apiKey = readEnv(spec.envPrefix, 'API_KEY')
    const baseUrl = readEnv(spec.envPrefix, 'BASE_URL')
    const model = readEnv(spec.envPrefix, 'MODEL')
    const provider = (readEnv(spec.envPrefix, 'PROVIDER') || defaultProvider(spec.serviceType)).toLowerCase()
    if (!apiKey || !baseUrl || !model) {
      console.warn(`[config-seed] skip ${spec.serviceType}: set ${spec.envPrefix}_API_KEY / _BASE_URL / _MODEL`)
      continue
    }
    if (!officialProviders[spec.serviceType].includes(provider)) {
      console.warn(`[config-seed] skip ${spec.serviceType}: unsupported provider ${provider}`)
      continue
    }

    await db.insert(schema.aiServiceConfigs).values({
      serviceType: spec.serviceType,
      provider,
      name: `platform-${spec.serviceType}`,
      baseUrl,
      apiKey,
      model: JSON.stringify([model]),
      priority: 100,
      isDefault: true,
      isActive: true,
      createdAt: ts,
      updatedAt: ts,
    })
    console.log(`[config-seed] inserted ${spec.serviceType} config (${provider} / ${model})`)
  }
  await ensureGeminiVideoConfig()
  await ensureMinimaxVideoConfig()
}

function defaultProvider(serviceType: ServiceType): string {
  if (serviceType === 'video') return 'gemini'
  return 'openai'
}

async function ensureGeminiVideoConfig() {
  const provider = (readEnv('DRAMA_VIDEO', 'PROVIDER') || 'gemini').toLowerCase()
  if (provider !== 'gemini') return

  const videos = ((await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, 'video'))) as Array<{ provider?: string | null; isActive?: unknown }>)
  if (videos.some((row) => row.provider === 'gemini' && row.isActive)) return

  let apiKey = readEnv('DRAMA_VIDEO', 'API_KEY')
  let baseUrl = readEnv('DRAMA_VIDEO', 'BASE_URL') || 'https://generativelanguage.googleapis.com'
  const model = readEnv('DRAMA_VIDEO', 'MODEL') || 'gemini-omni-flash-preview'

  if (!apiKey) {
    const donors = ((await db.select().from(schema.aiServiceConfigs)) as Array<{
      isActive?: unknown
      provider?: string | null
      serviceType?: string | null
      apiKey?: string | null
      baseUrl?: string | null
      priority?: number | null
    }>)
      .filter((row) => Boolean(row.isActive) && row.provider === 'gemini' && (row.serviceType === 'image' || row.serviceType === 'text'))
      .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0))
    const donor = donors[0]
    if (donor?.apiKey) {
      apiKey = donor.apiKey
      if (!readEnv('DRAMA_VIDEO', 'BASE_URL') && donor.baseUrl) baseUrl = donor.baseUrl
    }
  }
  if (!apiKey || !baseUrl) {
    console.warn('[config-seed] skip gemini video: set DRAMA_VIDEO_API_KEY or reuse an active Gemini text/image key')
    return
  }

  const ts = now()
  await db.insert(schema.aiServiceConfigs).values({
    serviceType: 'video',
    provider: 'gemini',
    name: 'platform-video',
    baseUrl,
    apiKey,
    model: JSON.stringify([model]),
    priority: 110,
    isDefault: true,
    isActive: true,
    createdAt: ts,
    updatedAt: ts,
  })
  console.log(`[config-seed] inserted video config (gemini / ${model})`)
}

/**
 * MiniMax H3 video reuses the TTS MiniMax key (MINIMAX_API_KEY) on api.minimax.io.
 * Inserts a secondary video config unless one is already active.
 * When DRAMA_VIDEO_PROVIDER=minimax it is seeded at higher priority so it becomes the default.
 */
async function ensureMinimaxVideoConfig() {
  const videos = ((await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, 'video'))) as Array<{ provider?: string | null; isActive?: unknown }>)
  if (videos.some((row) => row.provider === 'minimax' && row.isActive)) return

  const provider = (readEnv('DRAMA_VIDEO', 'PROVIDER') || 'gemini').toLowerCase()
  const apiKey = (
    process.env.MINIMAX_API_KEY
    || process.env.DRAMA_MINIMAX_API_KEY
    || (provider === 'minimax' ? readEnv('DRAMA_VIDEO', 'API_KEY') : '')
    || ''
  ).trim()
  const baseUrl = (
    process.env.MINIMAX_VIDEO_BASE_URL
    || process.env.MINIMAX_TTS_BASE_URL
    || (provider === 'minimax' ? readEnv('DRAMA_VIDEO', 'BASE_URL') : '')
    || 'https://api.minimax.io'
  ).trim()
  const model = (provider === 'minimax' ? readEnv('DRAMA_VIDEO', 'MODEL') : '') || 'MiniMax-H3'

  if (!apiKey) {
    console.warn('[config-seed] skip minimax video: set MINIMAX_API_KEY (same key as TTS)')
    return
  }

  const preferMinimax = provider === 'minimax'
  const ts = now()
  await db.insert(schema.aiServiceConfigs).values({
    serviceType: 'video',
    provider: 'minimax',
    name: 'platform-video-minimax',
    baseUrl,
    apiKey,
    model: JSON.stringify([model]),
    priority: preferMinimax ? 120 : 90,
    isDefault: preferMinimax,
    isActive: true,
    createdAt: ts,
    updatedAt: ts,
  })
  console.log(`[config-seed] inserted video config (minimax / ${model})`)
}

/**
 * Seed platform AI configs from env when none are active.
 * Customers never see the drama settings page; ops inject keys here.
 */
import { db, schema } from '../db/index.js'
import { eq } from '../db/query.js'
import { now } from '../utils/response.js'
import { officialProviders, type ServiceType } from './ai.js'
import { expandGeminiOmniVideoModels, parseConfigModels } from './video-clip-policy.js'

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
  await syncActiveConfigsFromEnv()
  await ensureGeminiVideoConfig()
  await ensureMinimaxVideoConfig()
  await ensureSeedanceVideoConfig()
}

type SeedConfigRow = {
  id?: number
  provider?: string | null
  isActive?: unknown
  baseUrl?: string | null
  apiKey?: string | null
  model?: unknown
  name?: string | null
}

async function syncActiveConfigsFromEnv() {
  for (const spec of SPECS) {
    const apiKey = readEnv(spec.envPrefix, 'API_KEY')
    const baseUrl = readEnv(spec.envPrefix, 'BASE_URL')
    const model = readEnv(spec.envPrefix, 'MODEL')
    const envProvider = readEnv(spec.envPrefix, 'PROVIDER').toLowerCase()
    const provider = (envProvider || defaultProvider(spec.serviceType)).toLowerCase()
    if (!apiKey || !baseUrl) continue
    if (!officialProviders[spec.serviceType].includes(provider)) continue

    const all = ((await db.select().from(schema.aiServiceConfigs)
      .where(eq(schema.aiServiceConfigs.serviceType, spec.serviceType))) as SeedConfigRow[])

    if (envProvider) {
      await switchActiveProviderFromEnv(spec, all, { provider, apiKey, baseUrl, model })
    }

    const rows = all.filter((r) => r.isActive && (r.provider || '').toLowerCase() === provider)
    const row = rows[0]
    if (row?.id == null) continue

    const updates: Record<string, unknown> = {}
    if (row.baseUrl !== baseUrl) updates.baseUrl = baseUrl
    if (row.apiKey !== apiKey) updates.apiKey = apiKey
    if (model) {
      const current = parseConfigModels(row.model)
      if (current[0] !== model) {
        updates.model = JSON.stringify([model, ...current.filter((item) => item !== model)])
      }
    }
    if (!Object.keys(updates).length) continue
    updates.updatedAt = now()
    await db.update(schema.aiServiceConfigs)
      .set(updates)
      .where(eq(schema.aiServiceConfigs.id, row.id))
    console.log(`[config-seed] updated ${spec.serviceType} config (${provider}) from env`)
  }
}

/**
 * When DRAMA_*_PROVIDER is set, activate that vendor and deactivate the others
 * of the same service type so episode-locked configs can fall back.
 */
async function switchActiveProviderFromEnv(
  spec: SeedSpec,
  all: SeedConfigRow[],
  env: { provider: string; apiKey: string; baseUrl: string; model: string },
) {
  const ts = now()
  for (const row of all) {
    if (row.id == null) continue
    if ((row.provider || '').toLowerCase() === env.provider) continue
    if (!row.isActive) continue
    await db.update(schema.aiServiceConfigs)
      .set({ isActive: false, isDefault: false, updatedAt: ts })
      .where(eq(schema.aiServiceConfigs.id, row.id))
    console.log(`[config-seed] deactivated ${spec.serviceType} config (${row.provider})`)
    row.isActive = false
  }

  const same = all.filter((r) => (r.provider || '').toLowerCase() === env.provider)
  const activeSame = same.find((r) => r.isActive)
  if (activeSame?.id != null) return

  const reusable = same[0]
  if (reusable?.id != null) {
    const current = parseConfigModels(reusable.model)
    const nextModel = env.model
      ? JSON.stringify([env.model, ...current.filter((item) => item !== env.model)])
      : reusable.model
    await db.update(schema.aiServiceConfigs)
      .set({
        isActive: true,
        isDefault: true,
        baseUrl: env.baseUrl,
        apiKey: env.apiKey,
        model: nextModel,
        updatedAt: ts,
      })
      .where(eq(schema.aiServiceConfigs.id, reusable.id))
    reusable.isActive = true
    reusable.baseUrl = env.baseUrl
    reusable.apiKey = env.apiKey
    reusable.model = nextModel
    console.log(`[config-seed] reactivated ${spec.serviceType} config (${env.provider})`)
    return
  }

  if (!env.model) {
    console.warn(`[config-seed] skip switch ${spec.serviceType}: set ${spec.envPrefix}_MODEL`)
    return
  }

  await db.insert(schema.aiServiceConfigs).values({
    serviceType: spec.serviceType,
    provider: env.provider,
    name: `platform-${spec.serviceType}`,
    baseUrl: env.baseUrl,
    apiKey: env.apiKey,
    model: JSON.stringify([env.model]),
    priority: 110,
    isDefault: true,
    isActive: true,
    createdAt: ts,
    updatedAt: ts,
  })
  all.push({
    provider: env.provider,
    isActive: true,
    baseUrl: env.baseUrl,
    apiKey: env.apiKey,
    model: JSON.stringify([env.model]),
  })
  console.log(`[config-seed] inserted ${spec.serviceType} config (${env.provider} / ${env.model})`)
}

function defaultProvider(serviceType: ServiceType): string {
  if (serviceType === 'video') return 'gemini'
  return 'openai'
}

async function ensureGeminiVideoConfig() {
  const provider = (readEnv('DRAMA_VIDEO', 'PROVIDER') || 'gemini').toLowerCase()
  if (provider !== 'gemini') return

  const videos = ((await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, 'video'))) as Array<{
      id?: number
      provider?: string | null
      isActive?: unknown
      model?: unknown
    }>)
  const existing = videos.find((row) => row.provider === 'gemini' && row.isActive)
  if (existing) {
    const current = parseConfigModels(existing.model)
    const merged = expandGeminiOmniVideoModels('gemini', current)
    if (existing.id != null && JSON.stringify(merged) !== JSON.stringify(current)) {
      await db.update(schema.aiServiceConfigs)
        .set({ model: JSON.stringify(merged), updatedAt: now() })
        .where(eq(schema.aiServiceConfigs.id, existing.id))
      console.log('[config-seed] updated video models (gemini omni 1.1)')
    }
    return
  }

  let apiKey = readEnv('DRAMA_VIDEO', 'API_KEY')
  let baseUrl = readEnv('DRAMA_VIDEO', 'BASE_URL') || 'https://generativelanguage.googleapis.com'
  const model = readEnv('DRAMA_VIDEO', 'MODEL') || 'gemini-omni-1.1-flash'

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
 * MiniMax H3 video uses MINIMAX_VIDEO_API_KEY on api.minimax.io.
 * Do not reuse the TTS MINIMAX_API_KEY.
 * When DRAMA_VIDEO_PROVIDER=minimax it is seeded at higher priority so it becomes the default.
 */
async function ensureMinimaxVideoConfig() {
  const videos = ((await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, 'video'))) as Array<{
      id?: number
      provider?: string | null
      isActive?: unknown
      apiKey?: string | null
    }>)
  const existing = videos.find((row) => row.provider === 'minimax' && row.isActive)

  const provider = (readEnv('DRAMA_VIDEO', 'PROVIDER') || 'gemini').toLowerCase()
  const apiKey = (
    process.env.MINIMAX_VIDEO_API_KEY
    || process.env.DRAMA_MINIMAX_VIDEO_API_KEY
    || (provider === 'minimax' ? readEnv('DRAMA_VIDEO', 'API_KEY') : '')
    || ''
  ).trim()
  const baseUrl = (
    process.env.MINIMAX_VIDEO_BASE_URL
    || (provider === 'minimax' ? readEnv('DRAMA_VIDEO', 'BASE_URL') : '')
    || 'https://api.minimax.io'
  ).trim()
  const model = (provider === 'minimax' ? readEnv('DRAMA_VIDEO', 'MODEL') : '') || 'MiniMax-H3'

  if (existing) {
    if (apiKey && existing.apiKey !== apiKey && existing.id != null) {
      await db.update(schema.aiServiceConfigs)
        .set({ apiKey, updatedAt: now() })
        .where(eq(schema.aiServiceConfigs.id, existing.id))
      console.log('[config-seed] updated video config api key (minimax)')
    }
    return
  }

  if (!apiKey) {
    console.warn('[config-seed] skip minimax video: set MINIMAX_VIDEO_API_KEY (H3 video key, not TTS)')
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

/**
 * Seedance 2.0 (BytePlus / Volcengine) stays active as MiniMax balance fallback.
 * Lower priority so Wizard still prefers MiniMax-H3 when that key has credit.
 */
async function ensureSeedanceVideoConfig() {
  const videos = ((await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, 'video'))) as Array<{
      id?: number
      provider?: string | null
      isActive?: unknown
      apiKey?: string | null
      baseUrl?: string | null
      model?: unknown
    }>)
  const existing = videos.find((row) => row.provider === 'volcengine' && row.isActive)

  const apiKey = (
    process.env.BYTEPLUS_ARK_API_KEY
    || process.env.DRAMA_SEEDANCE_API_KEY
    || process.env.ARK_API_KEY
    || ''
  ).trim()
  const baseUrl = (
    process.env.BYTEPLUS_ARK_VIDEO_BASE_URL
    || process.env.DRAMA_SEEDANCE_BASE_URL
    || 'https://ark.ap-southeast.bytepluses.com'
  ).replace(/\/+$/, '').replace(/\/api\/v3$/i, '')
  const model = (
    process.env.BYTEPLUS_ARK_VIDEO_MODEL
    || process.env.DRAMA_SEEDANCE_MODEL
    || 'dreamina-seedance-2-0-260128'
  ).trim()

  if (existing) {
    if (!apiKey || existing.id == null) return
    const updates: Record<string, unknown> = {}
    if (existing.apiKey !== apiKey) updates.apiKey = apiKey
    if (existing.baseUrl !== baseUrl) updates.baseUrl = baseUrl
    const current = parseConfigModels(existing.model)
    if (current[0] !== model) {
      updates.model = JSON.stringify([model, ...current.filter((item) => item !== model)])
    }
    if (!Object.keys(updates).length) return
    updates.updatedAt = now()
    await db.update(schema.aiServiceConfigs)
      .set(updates)
      .where(eq(schema.aiServiceConfigs.id, existing.id))
    console.log('[config-seed] updated video config (volcengine / Seedance fallback)')
    return
  }

  if (!apiKey) {
    console.warn('[config-seed] skip seedance video: set BYTEPLUS_ARK_API_KEY')
    return
  }

  const ts = now()
  await db.insert(schema.aiServiceConfigs).values({
    serviceType: 'video',
    provider: 'volcengine',
    name: 'platform-video-seedance',
    baseUrl,
    apiKey,
    model: JSON.stringify([model]),
    priority: 80,
    isDefault: false,
    isActive: true,
    createdAt: ts,
    updatedAt: ts,
  })
  console.log(`[config-seed] inserted video config (volcengine / ${model})`)
}

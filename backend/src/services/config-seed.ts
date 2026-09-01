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
}

function defaultProvider(serviceType: ServiceType): string {
  if (serviceType === 'video') return 'volcengine'
  return 'openai'
}

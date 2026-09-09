/**
 * Agent 请求上下文 — 通过 Mastra RequestContext 按请求注入
 * 路由层 build → generate({ requestContext }) → 工具 execute 内读取
 */
import { RequestContext } from '@mastra/core/request-context'

export interface AgentRequestContextValues {
  episodeId: number
  dramaId: number
  modelOverride?: string
  textConfigId?: number
  locale?: string
  genre?: string
  adPurpose?: string
  adForm?: string
  adAngle?: string
}

export function buildAgentRequestContext(values: AgentRequestContextValues): RequestContext<AgentRequestContextValues> {
  const rc = new RequestContext<AgentRequestContextValues>()
  rc.set('episodeId', values.episodeId)
  rc.set('dramaId', values.dramaId)
  if (values.modelOverride) rc.set('modelOverride', values.modelOverride)
  if (values.textConfigId) rc.set('textConfigId', values.textConfigId)
  if (values.locale) rc.set('locale', values.locale)
  if (values.genre) rc.set('genre', values.genre)
  if (values.adPurpose) rc.set('adPurpose', values.adPurpose)
  if (values.adForm) rc.set('adForm', values.adForm)
  if (values.adAngle) rc.set('adAngle', values.adAngle)
  return rc
}

export function parseContextId(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

export function getEpisodeId(requestContext: RequestContext | undefined): number | null {
  return parseContextId(requestContext?.get('episodeId' as never))
}

export function getDramaId(requestContext: RequestContext | undefined): number | null {
  return parseContextId(requestContext?.get('dramaId' as never))
}

export function getAgentLocale(requestContext: RequestContext | undefined): string | null {
  const v = requestContext?.get('locale' as never)
  return typeof v === 'string' && v.trim() ? v : null
}

export function getAgentGenre(requestContext: RequestContext | undefined): string | null {
  const v = requestContext?.get('genre' as never)
  return typeof v === 'string' && v.trim() ? v : null
}

function getAgentString(requestContext: RequestContext | undefined, key: 'adPurpose' | 'adForm' | 'adAngle'): string | null {
  const v = requestContext?.get(key as never)
  return typeof v === 'string' && v.trim() ? v : null
}

export function getAgentAdSpec(requestContext: RequestContext | undefined) {
  const purpose = getAgentString(requestContext, 'adPurpose')
  const form = getAgentString(requestContext, 'adForm')
  const angle = getAgentString(requestContext, 'adAngle')
  if (!purpose && !form && !angle) return null
  return { purpose, form, angle }
}

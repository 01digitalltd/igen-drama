/** MiniMax H3 V2 is CONN-capped (2 free / 15 paid). xAI Imagine accepts parallel jobs. Gemini/Seedance stay serial. */

export const MINIMAX_VIDEO_CONCURRENT_DEFAULT = 5
export const MINIMAX_VIDEO_CONCURRENT_CAP = 15
export const XAI_VIDEO_CONCURRENT_DEFAULT = 5
export const XAI_VIDEO_CONCURRENT_CAP = 15

function cappedConcurrent(raw: string | undefined, fallback: number, cap: number) {
  const fromEnv = Number(raw)
  if (Number.isFinite(fromEnv) && fromEnv >= 1) {
    return Math.min(cap, Math.max(1, Math.round(fromEnv)))
  }
  return fallback
}

export function videoMaxConcurrentForProvider(
  provider?: string | null,
  env: Record<string, string | undefined> = process.env,
) {
  const p = String(provider || '').toLowerCase()
  if (p === 'minimax') {
    return cappedConcurrent(env.DRAMA_VIDEO_CONCURRENT_MINIMAX, MINIMAX_VIDEO_CONCURRENT_DEFAULT, MINIMAX_VIDEO_CONCURRENT_CAP)
  }
  if (p === 'xai') {
    return cappedConcurrent(env.DRAMA_VIDEO_CONCURRENT_XAI, XAI_VIDEO_CONCURRENT_DEFAULT, XAI_VIDEO_CONCURRENT_CAP)
  }
  return 1
}

export function splitVideoQueueByConcurrency<T extends { provider?: string | null }>(
  queued: T[],
  runningByProvider: Map<string, number> | Record<string, number>,
  env: Record<string, string | undefined> = process.env,
) {
  const running = runningByProvider instanceof Map
    ? new Map(runningByProvider)
    : new Map(Object.entries(runningByProvider))
  const start: T[] = []
  const defer: T[] = []
  for (const item of queued) {
    const key = String(item.provider || '').toLowerCase()
    const max = videoMaxConcurrentForProvider(item.provider, env)
    const current = running.get(key) || 0
    if (current >= max) {
      defer.push(item)
      continue
    }
    running.set(key, current + 1)
    start.push(item)
  }
  return { start, defer }
}

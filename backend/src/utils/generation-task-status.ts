/** Statuses that mean a generation job is still occupying a storyboard/asset. */
export const ACTIVE_GENERATION_STATUSES = ['queued', 'pending', 'processing'] as const

export function isActiveGenerationStatus(status?: string | null): boolean {
  const s = String(status || '').trim().toLowerCase()
  return (ACTIVE_GENERATION_STATUSES as readonly string[]).includes(s)
}

export function pickLatestActiveTask<T extends { id?: unknown; status?: unknown; createdAt?: unknown }>(
  rows: T[],
): T | undefined {
  const active = rows.filter(row => isActiveGenerationStatus(row.status as string | null))
  if (!active.length) return undefined
  return [...active].sort((a, b) => {
    const byCreated = String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
    return byCreated !== 0 ? byCreated : Number(b.id) - Number(a.id)
  })[0]
}

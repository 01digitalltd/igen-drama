/**
 * In-process pub/sub for long-running episode jobs (extract, agent chat).
 * SSE / WebSocket subscribers live in this Node process — replicas must stay 1.
 */
export type EpisodeEventType = 'extract' | 'job' | 'task' | 'merge' | 'prompts'

export interface EpisodeEvent {
  type: EpisodeEventType
  payload: unknown
}

type Listener = (event: EpisodeEvent) => void

const listeners = new Map<number, Set<Listener>>()

export function subscribeEpisodeEvents(episodeId: number, listener: Listener): () => void {
  let set = listeners.get(episodeId)
  if (!set) {
    set = new Set()
    listeners.set(episodeId, set)
  }
  set.add(listener)
  return () => {
    set!.delete(listener)
    if (set!.size === 0) listeners.delete(episodeId)
  }
}

export function publishEpisodeEvent(episodeId: number, event: EpisodeEvent) {
  const set = listeners.get(episodeId)
  if (!set?.size) return
  for (const listener of [...set]) {
    try {
      listener(event)
    } catch {
      /* ignore subscriber errors */
    }
  }
}

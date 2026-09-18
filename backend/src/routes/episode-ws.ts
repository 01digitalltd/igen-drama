import type { Hono, MiddlewareHandler } from 'hono'
import { loadOwnedEpisode } from '../utils/ownership.js'
import { subscribeEpisodeEvents } from '../services/episode-events.js'
import { collectEpisodePushEvents } from '../services/episode-live-events.js'

type UpgradeWebSocket = (factory: (c: any) => any) => any

export function registerEpisodeWebSocket(
  app: Hono,
  upgradeWebSocket: UpgradeWebSocket,
  middlewares: MiddlewareHandler[] = [],
) {
  app.get(
    '/api/v1/episodes/:id/ws',
    ...middlewares,
    upgradeWebSocket((c) => {
      let unsub = () => {}
      let ping: ReturnType<typeof setInterval> | null = null
      let episodeId: number | null = null

      const sendAll = async (ws: { send: (data: string) => void }) => {
        if (episodeId == null) return
        const events = await collectEpisodePushEvents(episodeId)
        for (const event of events) {
          ws.send(JSON.stringify({ type: event.type, payload: event.payload }))
        }
      }

      return {
        onOpen: async (_event: unknown, ws: { send: (data: string) => void; close: () => void }) => {
          try {
            const ep = await loadOwnedEpisode(c, c.req.param('id'))
            episodeId = ep.id
            await sendAll(ws)
            unsub = subscribeEpisodeEvents(ep.id, (event) => {
              try {
                ws.send(JSON.stringify({ type: event.type, payload: event.payload }))
              } catch {
                /* socket already closing */
              }
            })
            ping = setInterval(() => {
              try {
                ws.send(JSON.stringify({ type: 'ping', payload: { t: Date.now() } }))
              } catch {
                /* ignore */
              }
            }, 15_000)
          } catch {
            ws.close()
          }
        },
        onMessage: async (event: { data: unknown }, ws: { send: (data: string) => void }) => {
          const raw = typeof event.data === 'string' ? event.data : ''
          let parsed: { type?: string } = {}
          try {
            parsed = raw ? JSON.parse(raw) as { type?: string } : {}
          } catch {
            parsed = {}
          }
          if (parsed.type === 'poll') {
            await sendAll(ws)
          }
        },
        onClose: () => {
          if (ping) clearInterval(ping)
          unsub()
        },
        onError: () => {
          if (ping) clearInterval(ping)
          unsub()
        },
      }
    }),
  )
}


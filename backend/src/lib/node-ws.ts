import { STATUS_CODES } from 'node:http'
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Hono } from 'hono'
import { defineWebSocketHelper, WSContext } from 'hono/ws'
import type { UpgradeWebSocket, WSEvents } from 'hono/ws'
import { WebSocketServer } from 'ws'
import type { RawData, WebSocket } from 'ws'

const CONNECTION_KEY = Symbol('ws-connection')

type UpgradeEnv = {
  incoming: IncomingMessage
  outgoing: undefined
  [CONNECTION_KEY]?: symbol
}

/**
 * WebSocket adapter for @hono/node-server v1, which does not export ./ws.
 * Uses the already-installed `ws` package instead of @hono/node-server/ws.
 */
export function createNodeWebSocket(init: { app: Hono }) {
  const wss = new WebSocketServer({ noServer: true })
  const waiters = new Map<IncomingMessage, { resolve: (socket: WebSocket) => void; token: symbol }>()

  wss.on('connection', (socket, request) => {
    const waiter = waiters.get(request)
    if (!waiter) return
    waiter.resolve(socket)
    waiters.delete(request)
  })

  const waitForSocket = (request: IncomingMessage, token: symbol) =>
    new Promise<WebSocket>((resolve) => {
      waiters.set(request, { resolve, token })
    })

  const upgradeWebSocket: UpgradeWebSocket = defineWebSocketHelper(async (c, events) => {
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') return
    const incoming = (c.env as UpgradeEnv | undefined)?.incoming
    if (!incoming) return
    const token = Symbol('connection')
    ;(c.env as UpgradeEnv)[CONNECTION_KEY] = token
    void bindSocketEvents(waitForSocket(incoming, token), events)
    return new Response()
  })

  function injectWebSocket(server: Server) {
    server.on('upgrade', async (request, socket: Duplex, head) => {
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      const headers = new Headers()
      for (const [key, value] of Object.entries(request.headers)) {
        if (!value) continue
        headers.set(key, Array.isArray(value) ? value[0]! : value)
      }
      if (!headers.has('upgrade')) headers.set('upgrade', 'websocket')
      const env: UpgradeEnv = { incoming: request, outgoing: undefined }
      let response: Response
      try {
        response = await init.app.request(url, { headers }, env)
      } catch {
        socket.end('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n')
        return
      }
      const waiter = waiters.get(request)
      if (!waiter || waiter.token !== env[CONNECTION_KEY]) {
        waiters.delete(request)
        socket.end(
          `HTTP/1.1 ${response.status} ${STATUS_CODES[response.status] ?? 'Error'}\r\n` +
            'Connection: close\r\nContent-Length: 0\r\n\r\n',
        )
        return
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    })
  }

  return { injectWebSocket, upgradeWebSocket, wss }
}

async function bindSocketEvents(ready: Promise<WebSocket>, events: WSEvents) {
  const socket = await ready
  const ctx = new WSContext({
    send(source) {
      socket.send(source)
    },
    close(code, reason) {
      socket.close(code, reason)
    },
    raw: socket,
    readyState: socket.readyState as 0 | 1 | 2 | 3,
    protocol: socket.protocol,
  })
  try {
    events.onOpen?.(new Event('open'), ctx)
  } catch (err) {
    console.error('[ws] onOpen', err)
  }
  socket.on('message', (data, isBinary) => {
    try {
      events.onMessage?.(new MessageEvent('message', { data: decodeWsData(data, isBinary) }), ctx)
    } catch (err) {
      console.error('[ws] onMessage', err)
    }
  })
  socket.on('close', () => {
    try {
      events.onClose?.(new Event('close') as CloseEvent, ctx)
    } catch (err) {
      console.error('[ws] onClose', err)
    }
  })
  socket.on('error', () => {
    try {
      events.onError?.(new Event('error'), ctx)
    } catch (err) {
      console.error('[ws] onError', err)
    }
  })
}

function decodeWsData(data: RawData, isBinary: boolean) {
  if (isBinary) return data
  if (typeof data === 'string') return data
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}

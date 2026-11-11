import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import type { ServerFrame } from '@wizard/dungeon-shared'
import type WebSocket from 'ws'
import { WebSocketServer } from 'ws'
import { verifyPlayerToken } from './auth.js'
import { createDungeonHttpHandler } from './http.js'
import type { PartyRegistry } from './registry.js'
import { bindPlayerSocket, MAX_CLIENT_MESSAGE_BYTES } from './socket-session.js'

export interface DungeonServerAddress {
  readonly host: string
  readonly port: number
  readonly url: string
}

export interface DungeonServerOptions {
  readonly registry: PartyRegistry
  readonly tokenSecret: string
  readonly seedKey: string
  readonly host?: string
  readonly port?: number
  readonly corsOrigin?: string
  readonly now?: () => Date
  readonly onError?: (error: unknown) => void
  readonly onFrame?: (measurement: { readonly bytes: number; readonly frame: ServerFrame }) => void
}

export interface DungeonServer {
  readonly registry: PartyRegistry
  start(): Promise<DungeonServerAddress>
  stop(): Promise<void>
  address(): DungeonServerAddress | null
}

const rejectUpgrade = (socket: Duplex, status: number, message: string, retryAt?: number): void => {
  const retry =
    retryAt === undefined
      ? ''
      : `Retry-After: ${Math.max(1, Math.ceil((retryAt - Date.now()) / 1_000))}\r\n`
  socket.end(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\n${retry}\r\n${message}`,
  )
}

const closeHttp = (server: HttpServer): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)))
  })

export const createDungeonServer = (options: DungeonServerOptions): DungeonServer => {
  const now = options.now ?? (() => new Date())
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MESSAGE_BYTES })
  const http = createServer(
    createDungeonHttpHandler({
      registry: options.registry,
      seedKey: options.seedKey,
      tokenSecret: options.tokenSecret,
      corsOrigin: options.corsOrigin ?? '*',
      ...(options.onError === undefined ? {} : { onError: options.onError }),
    }),
  )
  const alive = new Map<WebSocket, boolean>()
  const connectionCounts = new Map<string, number>()
  let currentAddress: DungeonServerAddress | null = null
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let stopping = false

  const report = (error: unknown): void => {
    try {
      options.onError?.(error)
    } catch {
      // Error reporting cannot own the transport lifecycle.
    }
  }

  http.on('upgrade', (request, socket, head) => {
    socket.pause()
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://dungeon.local')
      if (url.pathname !== '/ws') {
        rejectUpgrade(socket, 404, 'Not Found')
        return
      }
      const token = url.searchParams.get('token')
      const verified =
        token === null
          ? { ok: false as const, message: 'missing token' }
          : verifyPlayerToken(options.tokenSecret, token)
      if (!verified.ok) {
        rejectUpgrade(socket, 401, 'Unauthorized')
        return
      }
      const { viewer } = verified.value
      const claimedParty = url.searchParams.get('partyId') ?? url.searchParams.get('lobbyId')
      const claimedPlayer = url.searchParams.get('playerId')
      if (
        (claimedParty !== null && claimedParty !== viewer.partyId) ||
        (claimedPlayer !== null && claimedPlayer !== viewer.playerId)
      ) {
        rejectUpgrade(socket, 403, 'Forbidden')
        return
      }
      const opened = await options.registry.get(viewer.partyId)
      if (!opened.ok) {
        if (opened.code === 'BUSY') {
          rejectUpgrade(socket, 503, 'Service Unavailable', opened.retryAt)
        } else rejectUpgrade(socket, opened.code === 'NOT_FOUND' ? 404 : 503, 'Service Unavailable')
        return
      }
      if (opened.runtime.state().players[viewer.playerId] === undefined) {
        rejectUpgrade(socket, 403, 'Forbidden')
        return
      }
      socket.resume()
      wss.handleUpgrade(request, socket, head, (websocket) => {
        websocket.on('error', report)
        void bindPlayerSocket({
          socket: websocket,
          runtime: opened.runtime,
          viewer,
          now,
          alive,
          connectionCounts,
          isStopping: () => stopping,
          ...(options.onError === undefined ? {} : { onError: options.onError }),
          ...(options.onFrame === undefined ? {} : { onFrame: options.onFrame }),
        }).catch((error: unknown) => {
          report(error)
          websocket.close(1011, 'connection setup failed')
        })
      })
    })().catch((error: unknown) => {
      report(error)
      rejectUpgrade(socket, 500, 'Internal Server Error')
    })
  })

  const server: DungeonServer = {
    registry: options.registry,
    async start() {
      if (currentAddress !== null) return currentAddress
      stopping = false
      await options.registry.start()
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error)
        http.once('error', onError)
        http.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
          http.off('error', onError)
          resolve()
        })
      })
      const address = http.address()
      if (address === null || typeof address === 'string')
        throw new Error('server has no TCP address')
      const tcp: AddressInfo = address
      currentAddress = {
        host: tcp.address,
        port: tcp.port,
        url: `http://${tcp.family === 'IPv6' ? `[${tcp.address}]` : tcp.address}:${tcp.port}`,
      }
      heartbeat = setInterval(() => {
        for (const socket of wss.clients) {
          if (alive.get(socket) === false) socket.terminate()
          else {
            alive.set(socket, false)
            socket.ping()
          }
        }
      }, 15_000)
      return currentAddress
    },
    async stop() {
      if (stopping) return
      stopping = true
      if (heartbeat !== undefined) clearInterval(heartbeat)
      heartbeat = undefined
      for (const socket of wss.clients) socket.close(1001, 'server shutdown')
      if (currentAddress !== null) await closeHttp(http)
      currentAddress = null
      alive.clear()
      connectionCounts.clear()
      await options.registry.stop()
    },
    address: () => currentAddress,
  }
  return server
}

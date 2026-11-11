import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http'
import { signPlayerToken } from './auth.js'
import type { PartyRegistry } from './registry.js'
import {
  hasSeedKey,
  normalizeSeed,
  RequestBodyError,
  ResetRequestSchema,
  readJson,
  SeedRequestSchema,
  writeJson,
} from './transport-helpers.js'

const SEED_SESSION_LIFETIME_SECONDS = 600

export interface DungeonHttpOptions {
  readonly registry: PartyRegistry
  readonly seedKey: string
  readonly tokenSecret: string
  readonly corsOrigin: string
  readonly onError?: (error: unknown) => void
}

export const createDungeonHttpHandler = (options: DungeonHttpOptions): RequestListener => {
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://dungeon.local')
    if (request.method === 'OPTIONS') {
      writeJson(response, 204, {}, options.corsOrigin)
      return
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      writeJson(
        response,
        200,
        { status: 'ok', ready: true, activeParties: options.registry.listCached().length },
        options.corsOrigin,
      )
      return
    }
    const seedRoute = url.pathname === '/seed' || url.pathname === '/v1/dev/seed'
    const resetRoute = url.pathname === '/reset' || url.pathname === '/v1/dev/reset'
    if (request.method === 'POST' && (seedRoute || resetRoute)) {
      if (!hasSeedKey(request, options.seedKey)) {
        writeJson(response, 401, { error: 'unauthorized' }, options.corsOrigin)
        return
      }
      if (seedRoute) {
        const parsed = SeedRequestSchema.safeParse(await readJson(request))
        if (!parsed.success) {
          writeJson(response, 400, { error: 'invalid seed request' }, options.corsOrigin)
          return
        }
        const seed = normalizeSeed(parsed.data)
        if (seed.players.length < 2 || seed.players.length > 4) {
          writeJson(
            response,
            400,
            { error: 'a party needs two to four players' },
            options.corsOrigin,
          )
          return
        }
        const opened = await options.registry.seed(seed)
        if (!opened.ok) {
          const status = opened.code === 'BUSY' ? 503 : 500
          writeJson(response, status, { error: opened.code }, options.corsOrigin)
          return
        }
        const sessionExpiresAtSeconds =
          Math.floor(Date.now() / 1_000) + SEED_SESSION_LIFETIME_SECONDS
        const sessions = seed.players.map((player) => ({
          partyId: seed.partyId,
          playerId: player.id,
          displayName: player.name,
          token: signPlayerToken(options.tokenSecret, {
            partyId: seed.partyId,
            playerId: player.id,
            expiresAtSeconds: sessionExpiresAtSeconds,
          }),
        }))
        writeJson(
          response,
          201,
          { partyId: seed.partyId, seed: seed.seed, sessions },
          options.corsOrigin,
        )
        return
      }
      const parsed = ResetRequestSchema.safeParse(await readJson(request))
      if (!parsed.success) {
        writeJson(response, 400, { error: 'invalid reset request' }, options.corsOrigin)
        return
      }
      const opened = await options.registry.get(parsed.data.partyId)
      if (!opened.ok) {
        const status = opened.code === 'NOT_FOUND' ? 404 : opened.code === 'BUSY' ? 503 : 500
        writeJson(response, status, { error: opened.code }, options.corsOrigin)
        return
      }
      await opened.runtime.reset(parsed.data.seed ?? opened.runtime.state().seed)
      writeJson(response, 200, { ok: true, partyId: parsed.data.partyId }, options.corsOrigin)
      return
    }
    writeJson(response, 404, { error: 'not found' }, options.corsOrigin)
  }

  return (request, response) => {
    void handle(request, response).catch((error: unknown) => {
      try {
        options.onError?.(error)
      } catch {
        // Error reporting must not prevent a response.
      }
      if (!response.headersSent) {
        const bodyError = error instanceof RequestBodyError ? error : undefined
        writeJson(
          response,
          bodyError?.status ?? 500,
          { error: bodyError?.message ?? 'server error' },
          options.corsOrigin,
        )
      } else response.end()
    })
  }
}

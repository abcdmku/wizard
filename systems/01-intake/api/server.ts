import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import cors from '@fastify/cors'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  createIntakeApplicationService,
  type IntakeApplicationService,
} from './application-service.js'
import { createIntakeDatabase, type IntakeDatabase } from './db/index.js'
import { createIntakeDeps } from './deps.js'
import { intakeHttpRoutes } from './http/index.js'
import { startRiskCompletionRelay } from './risk-relay.js'
import { createIntakeRuntimeRegistry } from './runtime/index.js'

export interface CreateIntakeServerOptions {
  readonly database?: IntakeDatabase
  readonly ownerId?: string
  readonly logger?: boolean
  readonly corsOrigin?: boolean | string
  readonly heartbeatMs?: number
  readonly relayPollIntervalMs?: number
  readonly onError?: (error: unknown) => void
}

export interface IntakeServer {
  readonly app: FastifyInstance
  readonly database: IntakeDatabase
  readonly service: IntakeApplicationService
}

export async function createIntakeServer(
  options: CreateIntakeServerOptions = {},
): Promise<IntakeServer> {
  const database = options.database ?? createIntakeDatabase()
  const ownsDatabase = options.database === undefined
  const ownerId = options.ownerId ?? `intake-api:${hostname()}:${process.pid}:${randomUUID()}`
  const onError = options.onError ?? (() => undefined)

  await database.ensureSchema()
  const deps = createIntakeDeps(database)
  const service = createIntakeApplicationService({
    database,
    runtimeFactory: () =>
      createIntakeRuntimeRegistry({
        applications: database.applications,
        durableStore: database.durableStore,
        deps,
        ownerId,
        onError,
      }),
  })
  await service.runtime().reopenActive()

  const relay = startRiskCompletionRelay({
    database,
    getRuntime: () => service.runtime(),
    ...(options.relayPollIntervalMs === undefined
      ? {}
      : { pollIntervalMs: options.relayPollIntervalMs }),
    onError,
  })
  const app = Fastify({ logger: options.logger ?? true })
  let resourcesClosed = false

  await app.register(cors, { origin: options.corsOrigin ?? true })
  await app.register(intakeHttpRoutes, {
    service,
    ...(options.heartbeatMs === undefined ? {} : { heartbeatMs: options.heartbeatMs }),
  })
  app.addHook('onClose', async () => {
    if (resourcesClosed) return
    resourcesClosed = true
    relay.stop()
    await relay.done
    await service.shutdown()
    if (ownsDatabase) await database.close()
  })

  return { app, database, service }
}

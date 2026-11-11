import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { z } from 'zod'
import { createPostgresPersistence } from './postgres.js'
import { createPartyRegistry } from './registry.js'
import { createDungeonServer } from './transport.js'

const EnvironmentSchema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(0).max(65_535).default(8080),
  DUNGEON_DATABASE_URL: z.url().optional(),
  DATABASE_URL: z.url().optional(),
  JWT_SECRET: z.string().min(16),
  SEED_KEY: z.string().min(8),
  CORS_ORIGIN: z.string().default('*'),
})

const environment = EnvironmentSchema.parse(process.env)
const databaseUrl = environment.DUNGEON_DATABASE_URL ?? environment.DATABASE_URL
if (databaseUrl === undefined) throw new Error('DUNGEON_DATABASE_URL or DATABASE_URL is required')

const persistence = createPostgresPersistence(databaseUrl)
await persistence.migrate()

const registry = createPartyRegistry({
  store: persistence.store,
  directory: persistence.directory,
  ownerId: `${hostname()}:${process.pid}:${randomUUID()}`,
  onError: (error) => process.stderr.write(`dungeon registry error: ${String(error)}\n`),
})
const server = createDungeonServer({
  registry,
  tokenSecret: environment.JWT_SECRET,
  seedKey: environment.SEED_KEY,
  host: environment.HOST,
  port: environment.PORT,
  corsOrigin: environment.CORS_ORIGIN,
  onError: (error) => process.stderr.write(`dungeon server error: ${String(error)}\n`),
})

const address = await server.start()
process.stdout.write(`dungeon server listening on ${address.url}\n`)

let shuttingDown = false
const shutdown = (): void => {
  if (shuttingDown) return
  shuttingDown = true
  void server
    .stop()
    .then(() => persistence.close())
    .catch((error: unknown) => {
      process.stderr.write(`dungeon shutdown error: ${String(error)}\n`)
      process.exitCode = 1
    })
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

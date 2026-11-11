import { Layer } from 'effect'
import { FleetAuthLive } from './auth.js'
import { makeFleetDatabaseLive } from './database/index.js'

const connectionString =
  process.env.DATABASE_URL?.trim() || 'postgres://fleet:fleet@localhost:5432/fleet'

const FleetDatabaseLive = makeFleetDatabaseLive({
  connectionString,
  maxConnections: 10,
  connectionTimeoutMillis: 5_000,
})

export const FleetInfrastructureLive = FleetAuthLive.pipe(Layer.provideMerge(FleetDatabaseLive))

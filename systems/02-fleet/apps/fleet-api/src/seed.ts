import { pathToFileURL } from 'node:url'
import { NodeRuntime } from '@effect/platform-node'
import type { SeedCounts } from '@openwizard/fleet-shared'
import { Effect } from 'effect'
import { FleetRepository, makeFleetDatabaseLive } from './database/index.js'
import { type FleetSeedData, fleetSeedData } from './seed-data.js'

/**
 * The store applies this stable seed key and the record ids as upsert keys in one transaction.
 * Calling seedFleet again must return the same totals without inserting duplicate records.
 */
export interface SeedStore<Error = never> {
  readonly seed: (data: FleetSeedData) => Effect.Effect<SeedCounts, Error>
}

export const seedFleet = <Error>(store: SeedStore<Error>): Effect.Effect<SeedCounts, Error> =>
  store.seed(fleetSeedData)

export function seedDatabase(connectionString: string) {
  const program = Effect.gen(function* () {
    const repository = yield* FleetRepository
    yield* repository.migrate
    const counts = yield* repository.seed(fleetSeedData)
    if (counts.tenants !== 2 || counts.vehicles !== 4 || counts.deliveries !== 2) {
      return yield* Effect.fail(new Error('Fleet seed totals did not match the demo contract'))
    }
    return counts
  })
  return program.pipe(Effect.provide(makeFleetDatabaseLive({ connectionString })))
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const connectionString =
    process.env.DATABASE_URL?.trim() || 'postgres://fleet:fleet@localhost:5432/fleet'
  seedDatabase(connectionString).pipe(
    Effect.tap((counts) =>
      Effect.sync(() => process.stdout.write(`${JSON.stringify({ seeded: true, ...counts })}\n`)),
    ),
    NodeRuntime.runMain,
  )
}

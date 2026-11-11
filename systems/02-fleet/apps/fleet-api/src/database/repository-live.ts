import { PgClient } from '@effect/sql-pg'
import { Effect, Layer } from 'effect'
import { fleetMigration001 } from '../../migrations/001_fleet'
import { databaseError } from './errors'
import { makeReadQueries } from './read-queries'
import { FleetRepository } from './repository'
import { makeSeed } from './seed-data'
import { makeWriteQueries } from './write-queries'

const makeFleetRepository = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient
  const migrate = Effect.asVoid(sql.unsafe(fleetMigration001)).pipe(
    Effect.mapError(databaseError('migrate')),
  )
  const reads = makeReadQueries(sql)
  const writes = makeWriteQueries(sql)

  return FleetRepository.of({
    migrate,
    seed: makeSeed(sql),
    ...reads,
    ...writes,
  })
})

export const FleetRepositoryLive = Layer.effect(FleetRepository, makeFleetRepository)

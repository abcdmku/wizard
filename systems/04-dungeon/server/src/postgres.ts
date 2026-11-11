import { readFile } from 'node:fs/promises'
import { createPgDrizzleDurableStore, definePgDurableSchema } from '@openwizard/drizzle/pg'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import type { PartyDirectory } from './directory.js'

export const dungeonDurableSchema = definePgDurableSchema({ tablePrefix: 'dungeon_' })

type SqlClient = ReturnType<typeof postgres>

const createPostgresPartyDirectory = (sql: SqlClient): PartyDirectory => ({
  async register(party) {
    await sql`
      INSERT INTO dungeon_parties (party_id, run_key)
      VALUES (${party.partyId}, ${party.runKey})
      ON CONFLICT (party_id) DO UPDATE
      SET run_key = excluded.run_key, updated_at = now()
    `
  },
  async list() {
    const rows = await sql<{ party_id: string; run_key: string }[]>`
      SELECT party_id, run_key FROM dungeon_parties ORDER BY party_id
    `
    return rows.map((row) => ({ partyId: row.party_id, runKey: row.run_key }))
  },
  async remove(partyId) {
    await sql`DELETE FROM dungeon_parties WHERE party_id = ${partyId}`
  },
})

export interface PostgresPersistence {
  readonly store: ReturnType<typeof createPgDrizzleDurableStore>
  readonly directory: PartyDirectory
  migrate(): Promise<void>
  close(): Promise<void>
}

export const createPostgresPersistence = (databaseUrl: string): PostgresPersistence => {
  const sql = postgres(databaseUrl, { max: 20 })
  const db = drizzle(sql, { schema: dungeonDurableSchema })
  return {
    store: createPgDrizzleDurableStore(db, dungeonDurableSchema),
    directory: createPostgresPartyDirectory(sql),
    async migrate() {
      const migration = await readFile(
        new URL('../migrations/001_dungeon.sql', import.meta.url),
        'utf8',
      )
      await sql.unsafe(migration)
    },
    async close() {
      await sql.end({ timeout: 5 })
    },
  }
}

import { createPostgresPersistence } from './postgres.js'

const databaseUrl = process.env.DUNGEON_DATABASE_URL ?? process.env.DATABASE_URL
if (databaseUrl === undefined) throw new Error('DUNGEON_DATABASE_URL or DATABASE_URL is required')

const persistence = createPostgresPersistence(databaseUrl)
try {
  await persistence.migrate()
} finally {
  await persistence.close()
}

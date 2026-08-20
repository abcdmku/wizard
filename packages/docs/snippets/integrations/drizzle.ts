import { createPgDrizzleDurableStore, definePgDurableSchema } from '@openwizard/drizzle/pg'

export const durableSchema = definePgDurableSchema({
  tablePrefix: 'workflow_',
})

type Database = Parameters<typeof createPgDrizzleDurableStore>[0]

export function createDurableStore(db: Database) {
  return createPgDrizzleDurableStore(db, durableSchema)
}

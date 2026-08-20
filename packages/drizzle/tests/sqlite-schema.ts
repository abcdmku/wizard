import { defineSqliteDurableSchema } from '../src/sqlite'

export const sqliteDurableSchema = defineSqliteDurableSchema({ tablePrefix: 'test_wizard_' })
export const { runs, dedupe, timers } = sqliteDurableSchema

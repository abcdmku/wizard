import { definePgDurableSchema } from '../src/pg'

export const pgDurableSchema = definePgDurableSchema({ tablePrefix: 'test_wizard_' })
export const { runs, dedupe, timers } = pgDurableSchema

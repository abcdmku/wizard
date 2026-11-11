import { definePgDurableSchema } from '@openwizard/drizzle/pg'

export const durableSchema = definePgDurableSchema({ tablePrefix: 'fulfillment_wizard_' })

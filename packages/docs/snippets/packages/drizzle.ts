import { defineSqliteDurableSchema } from '@openwizard/drizzle/sqlite'

export const openWizardTables = defineSqliteDurableSchema({
  tablePrefix: 'workflow_',
})

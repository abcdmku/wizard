import type { DurableStore } from '@openwizard/durable'
import { expectTypeOf } from 'vitest'
import type { DrizzleDurableStoreOptions } from '../src'
import { createPgDrizzleDurableStore, definePgDurableSchema, type PgDurableSchema } from '../src/pg'
import {
  createSqliteDrizzleDurableStore,
  defineSqliteDurableSchema,
  type SqliteDurableSchema,
} from '../src/sqlite'

expectTypeOf(definePgDurableSchema()).toMatchTypeOf<PgDurableSchema>()
expectTypeOf(defineSqliteDurableSchema()).toMatchTypeOf<SqliteDurableSchema>()
expectTypeOf(createPgDrizzleDurableStore).returns.toEqualTypeOf<DurableStore>()
expectTypeOf(createSqliteDrizzleDurableStore).returns.toEqualTypeOf<DurableStore>()
expectTypeOf<DrizzleDurableStoreOptions>().toMatchTypeOf<{
  readonly now?: () => number
}>()

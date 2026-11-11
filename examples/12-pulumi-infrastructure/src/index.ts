import * as pulumi from '@pulumi/pulumi'
import { bindDurableDatabase, parseDurableDatabaseDialect } from './database-binding'

const config = new pulumi.Config()
const database = bindDurableDatabase({
  dialect: parseDurableDatabaseDialect(config.require('databaseDialect')),
  connectionUrl: config.requireSecret('databaseUrl'),
})

export const databaseDialect = database.dialect
export const databaseUrl = database.connectionUrl

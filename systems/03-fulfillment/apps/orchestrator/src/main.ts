import { FulfillmentApplicationService } from './application-service'
import { loadConfig } from './config'
import { createDatabase } from './db/database'
import { PostgresOrderCatalog } from './db/postgres-catalog'
import { DurableOrderRegistry } from './registry'
import { seedDemo } from './seed'
import { createOrchestratorApp } from './server'
import { SnsPartnerGateway } from './sns-gateway'

const config = loadConfig()
const database = await createDatabase(config.databaseUrl, {
  leaseTtlMs: config.leaseTtlMs,
  timerClaimTtlMs: config.leaseTtlMs,
})
const catalog = new PostgresOrderCatalog(database.pool)
const gateway = new SnsPartnerGateway(config.aws)
const registry = new DurableOrderRegistry({
  store: database.durableStore,
  catalog,
  deps: { gateway, now: () => new Date().toISOString() },
  ownerId: config.ownerId,
  leaseTtlMs: config.leaseTtlMs,
  renewEveryMs: config.leaseRenewMs,
})
const service = new FulfillmentApplicationService({
  catalog,
  registry,
  callbackUrl: config.callbackUrl,
})

await service.recoverActiveOrders()

const app = createOrchestratorApp({
  service,
  authTokens: config.authTokens,
  webhookSecrets: config.webhookSecrets,
  seedKey: config.seedKey,
  healthCheck: async () => {
    await database.pool.query('SELECT 1')
  },
})

let stopping = false
const shutdown = async () => {
  if (stopping) return
  stopping = true
  await app.close()
  await registry.disposeAll()
  gateway.close()
  await database.pool.end()
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())

await app.listen({ host: config.host, port: config.port })
if (config.seedOnStart) await seedDemo(service)

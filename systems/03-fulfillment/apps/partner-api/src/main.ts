import { loadConfig } from './config'
import { createPartnerApp } from './server'

const config = loadConfig()
const app = createPartnerApp({
  callbackDelayMs: config.callbackDelayMs,
  webhookSecret: config.webhookSecret,
})

const shutdown = async () => {
  await app.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())

await app.listen({ host: config.host, port: config.port })

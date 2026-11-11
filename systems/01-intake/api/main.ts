import { createIntakeServer } from './server.js'

const port = readPort(process.env.PORT)
const server = await createIntakeServer()
let stopping = false

async function stop(): Promise<void> {
  if (stopping) return
  stopping = true
  await server.app.close()
}

process.once('SIGINT', () => void stop())
process.once('SIGTERM', () => void stop())

try {
  await server.app.listen({ host: '0.0.0.0', port })
} catch (error) {
  await stop()
  throw error
}

function readPort(value: string | undefined): number {
  const port = value === undefined ? 4310 : Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError('PORT must be an integer from 1 through 65535')
  }
  return port
}

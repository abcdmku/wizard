import { randomUUID } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'

import { createIntakeDatabase } from '../../api/db/index'
import {
  createRiskWorker,
  DEFAULT_JOB_DURATION_MS,
  DEFAULT_POLL_INTERVAL_MS,
} from '../../api/worker/index'

const port = integer(process.env.PORT, 4320)
const durationMs = integer(process.env.JOB_DURATION_MS, DEFAULT_JOB_DURATION_MS)
const pollIntervalMs = integer(process.env.POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS)
const workerId = process.env.WORKER_ID ?? `review-worker-${randomUUID()}`
const database = createIntakeDatabase({ defaultLeaseMs: Math.max(durationMs + 10_000, 30_000) })
let stopping = false

function integer(value: string | undefined, fallback: number): number {
  const result = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(result) || result < 0)
    throw new Error('worker timing values must be non-negative integers')
  return result
}

function send(
  response: ServerResponse,
  status: number,
  body: unknown,
  contentType = 'application/json',
): void {
  response.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' })
  response.end(contentType === 'application/json' ? JSON.stringify(body) : String(body))
}

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    return send(response, 200, {
      ok: true,
      service: 'review-worker',
      workerId,
      durationMs,
      ...worker.stats,
    })
  }
  if (request.method === 'GET' && request.url === '/metrics') {
    return send(
      response,
      200,
      Object.entries(worker.stats)
        .map(([key, value]) => `intake_review_worker_${key}_total ${value}`)
        .join('\n'),
      'text/plain; version=0.0.4',
    )
  }
  send(response, 404, { ok: false, code: 'NOT_FOUND', message: 'Not found' })
})

await database.ensureSchema()
const worker = createRiskWorker({
  queue: database.riskJobs,
  workerId,
  jobDurationMs: durationMs,
  pollIntervalMs,
})
const running = worker.run().then(() => {
  if (!stopping) process.exitCode = 1
})
server.listen(port, '0.0.0.0')

async function stop(): Promise<void> {
  if (stopping) return
  stopping = true
  worker.stop()
  await running
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await database.close()
}

process.once('SIGINT', () => void stop())
process.once('SIGTERM', () => void stop())

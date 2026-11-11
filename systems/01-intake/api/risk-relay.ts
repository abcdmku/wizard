import type { RiskCompletedEvent } from '../shared/index.js'
import type { IntakeDatabase, RiskJobRecord } from './db/index.js'
import type { IntakeRuntimeService } from './runtime/index.js'

export const DEFAULT_RISK_RELAY_POLL_INTERVAL_MS = 1_000
export const DEFAULT_RISK_RELAY_BATCH_SIZE = 100

export type RiskRelayWait = (durationMs: number, signal?: AbortSignal) => Promise<void>
export type RiskRelayRuntime = IntakeRuntimeService | Promise<IntakeRuntimeService>

export interface RiskRelayOptions {
  readonly database: IntakeDatabase
  readonly getRuntime: () => RiskRelayRuntime
  readonly pollIntervalMs?: number
  readonly batchSize?: number
  readonly wait?: RiskRelayWait
  readonly signal?: AbortSignal
  readonly onError?: (error: unknown) => void
}

export interface RiskRelayStats {
  readonly polled: number
  readonly delivered: number
  readonly skipped: number
  readonly retained: number
  readonly errors: number
}

export interface RiskRelayHandle {
  readonly signal: AbortSignal
  run(): Promise<RiskRelayStats>
  stop(): void
}

export interface RiskCompletionRelayHandle {
  readonly done: Promise<void>
  stop(): void
}

interface MutableRiskRelayStats {
  polled: number
  delivered: number
  skipped: number
  retained: number
  errors: number
}

/** Wait for a real duration while allowing relay shutdown to interrupt it. */
export function waitForRiskRelayDuration(durationMs: number, signal?: AbortSignal): Promise<void> {
  readDuration(durationMs, 'durationMs')
  if (signal?.aborted === true) return Promise.reject(abortError())
  if (durationMs === 0) return Promise.resolve()

  return new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = (): void => finish(() => reject(abortError()))
    const timer = setTimeout(() => finish(resolve), durationMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted === true) onAbort()
  })
}

/** Deliver one completed risk row, retaining it when delivery is not durable. */
export async function deliverRiskJob(
  options: RiskRelayOptions,
  job: RiskJobRecord,
): Promise<'delivered' | 'skipped' | 'retained'> {
  const event = riskCompletedEvent(job)
  if (event === null) return 'skipped'

  try {
    const runtime = await options.getRuntime()
    const sent = await runtime.completeRisk(job.applicationId, event, `risk:${job.id}:completed`)
    if (!sent.ok) {
      reportError(options.onError, new Error(`risk event delivery failed: ${sent.code}`))
      return 'retained'
    }

    await options.database.riskJobs.markDelivered(job.tenantId, job.id)
    return 'delivered'
  } catch (error) {
    if (!isAbortError(error) || options.signal?.aborted !== true) {
      reportError(options.onError, error)
    }
    return 'retained'
  }
}

/** Poll and process one configured batch of completed risk rows. */
export async function processRiskRelayBatch(
  options: RiskRelayOptions,
  stats?: MutableRiskRelayStats,
): Promise<number> {
  const batchSize = readBatchSize(options.batchSize)
  const jobs = await options.database.riskJobs.undelivered({ limit: batchSize })
  if (stats !== undefined) stats.polled += jobs.length

  for (const job of jobs) {
    if (options.signal?.aborted === true) break
    const result = await deliverRiskJob(options, job)
    if (stats === undefined) continue
    if (result === 'delivered') stats.delivered += 1
    else if (result === 'skipped') stats.skipped += 1
    else stats.retained += 1
  }
  return jobs.length
}

/** Run the relay until its signal is aborted; aborting resolves cleanly. */
export async function runRiskRelay(options: RiskRelayOptions): Promise<RiskRelayStats> {
  const signal = options.signal ?? new AbortController().signal
  const pollIntervalMs = readDuration(
    options.pollIntervalMs ?? DEFAULT_RISK_RELAY_POLL_INTERVAL_MS,
    'pollIntervalMs',
  )
  readBatchSize(options.batchSize)
  const wait = options.wait ?? waitForRiskRelayDuration
  const onError = options.onError
  const stats: MutableRiskRelayStats = {
    polled: 0,
    delivered: 0,
    skipped: 0,
    retained: 0,
    errors: 0,
  }

  while (signal.aborted === false) {
    try {
      await processRiskRelayBatch({ ...options, signal }, stats)
    } catch (error) {
      if (signal.aborted || isAbortError(error)) break
      stats.errors += 1
      reportError(onError, error)
    }
    if (signal.aborted) break
    try {
      await wait(pollIntervalMs, signal)
    } catch (error) {
      if (signal.aborted || isAbortError(error)) break
      stats.errors += 1
      reportError(onError, error)
    }
  }
  return stats
}

/** Create a stoppable relay loop whose runtime may be replaced between polls. */
export function createRiskRelay(options: RiskRelayOptions): RiskRelayHandle {
  const controller = new AbortController()
  const linked = linkSignals(options.signal, controller.signal)
  const runOptions: RiskRelayOptions = { ...options, signal: linked.signal }
  let running: Promise<RiskRelayStats> | undefined

  return {
    signal: linked.signal,
    run() {
      if (running === undefined) {
        running = runRiskRelay(runOptions).finally(linked.dispose)
      }
      return running
    },
    stop() {
      controller.abort()
    },
  }
}

/** Start a relay with a shutdown promise suitable for an API process lifecycle. */
export function startRiskCompletionRelay(options: RiskRelayOptions): RiskCompletionRelayHandle {
  const relay = createRiskRelay(options)
  const done = relay.run().then(() => undefined)
  return { done, stop: relay.stop }
}

function riskCompletedEvent(job: RiskJobRecord): RiskCompletedEvent | null {
  if (
    job.status !== 'completed' ||
    job.score === null ||
    job.outcome === null ||
    job.reasons === null ||
    job.completedAt === null
  ) {
    return null
  }
  return {
    jobId: job.id,
    score: job.score,
    outcome: job.outcome,
    reasons: Array.from(job.reasons),
    completedAt: job.completedAt.toISOString(),
  }
}

function reportError(onError: ((error: unknown) => void) | undefined, error: unknown): void {
  try {
    onError?.(error)
  } catch {
    // Error reporting must not stop delivery retries.
  }
}

function readDuration(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`)
  }
  return value
}

function readBatchSize(value: number | undefined): number {
  const batchSize = value ?? DEFAULT_RISK_RELAY_BATCH_SIZE
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new RangeError('batchSize must be an integer from 1 through 500')
  }
  return batchSize
}

function abortError(): Error {
  const error = new Error('risk relay stopped')
  error.name = 'AbortError'
  return error
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function linkSignals(
  first: AbortSignal | undefined,
  second: AbortSignal,
): { readonly signal: AbortSignal; readonly dispose: () => void } {
  if (first === undefined) return { signal: second, dispose: () => undefined }
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  first.addEventListener('abort', abort, { once: true })
  second.addEventListener('abort', abort, { once: true })
  if (first.aborted || second.aborted) controller.abort()
  return {
    signal: controller.signal,
    dispose: () => {
      first.removeEventListener('abort', abort)
      second.removeEventListener('abort', abort)
    },
  }
}

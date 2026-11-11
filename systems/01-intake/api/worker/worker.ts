import type { RiskJobQueue } from '../db/risk-queue.js'
import type { RiskJobRecord } from '../db/schema.js'
import { assessRisk, type RiskAssessment } from './risk-assessment.js'

export const DEFAULT_JOB_DURATION_MS = 5_000
export const DEFAULT_POLL_INTERVAL_MS = 250
export const DEFAULT_RETRY_AFTER_MS = 1_000

export type RiskWorkerWait = (durationMs: number, signal?: AbortSignal) => Promise<void>

export interface RiskWorkerOptions {
  readonly queue: RiskJobQueue
  readonly workerId: string
  readonly jobDurationMs?: number
  readonly pollIntervalMs?: number
  readonly retryAfterMs?: number
  readonly leaseMs?: number
  readonly wait?: RiskWorkerWait
  readonly signal?: AbortSignal
}

export interface RiskWorkerStats {
  readonly claimed: number
  readonly completed: number
  readonly failed: number
  readonly requeued: number
  readonly leaseLost: number
  readonly errors: number
}

export type RiskJobProcessResult =
  | { readonly status: 'idle' }
  | { readonly status: 'completed'; readonly job: RiskJobRecord; readonly result: RiskAssessment }
  | { readonly status: 'failed'; readonly job: RiskJobRecord; readonly error: string }
  | { readonly status: 'requeued'; readonly job: RiskJobRecord }

export interface RiskWorkerHandle {
  readonly signal: AbortSignal
  readonly stats: RiskWorkerStats
  run(): Promise<RiskWorkerStats>
  stop(): void
}

interface MutableStats {
  claimed: number
  completed: number
  failed: number
  requeued: number
  leaseLost: number
  errors: number
}

/** Wait for a real duration, while allowing worker shutdown to interrupt it. */
export function waitForDuration(durationMs: number, signal?: AbortSignal): Promise<void> {
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

/** Process at most one job. A null claim is an idle poll and not an error. */
export async function processRiskJob(
  options: RiskWorkerOptions,
  stats?: MutableStats,
): Promise<RiskJobProcessResult> {
  const durationMs = readDuration(options.jobDurationMs ?? DEFAULT_JOB_DURATION_MS, 'jobDurationMs')
  const retryAfterMs = readDuration(options.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS, 'retryAfterMs')
  const wait = options.wait ?? waitForDuration
  const signal = options.signal
  const job = await claim(options)
  if (job === null) return { status: 'idle' }
  if (stats !== undefined) stats.claimed += 1

  try {
    await wait(durationMs, signal)
    if (isAborted(signal)) {
      return await requeueAfterAbort(options, job, stats)
    }

    const result = assessRisk(job.input)
    if (isAborted(signal)) {
      return await requeueAfterAbort(options, job, stats)
    }

    const completed = await options.queue.complete({
      jobId: job.id,
      workerId: options.workerId,
      score: result.score,
      outcome: result.outcome,
      reasons: result.reasons,
    })
    if (completed === null) {
      return await failOwnedJob(
        options,
        job,
        new Error('risk job lease was lost before completion'),
        retryAfterMs,
        stats,
      )
    }
    if (stats !== undefined) stats.completed += 1
    return { status: 'completed', job: completed, result }
  } catch (error) {
    if (signal?.aborted === true || isAbortError(error)) {
      return await requeueAfterAbort(options, job, stats)
    }
    return await failOwnedJob(options, job, error, retryAfterMs, stats)
  }
}

/** Run the queue until its signal is aborted; aborting resolves cleanly. */
export async function runRiskWorker(options: RiskWorkerOptions): Promise<RiskWorkerStats> {
  const stats = createStats()
  await runRiskWorkerLoop(options, stats)
  return snapshotStats(stats)
}

async function runRiskWorkerLoop(options: RiskWorkerOptions, stats: MutableStats): Promise<void> {
  const signal = options.signal ?? new AbortController().signal
  const pollIntervalMs = readDuration(
    options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    'pollIntervalMs',
  )
  const wait = options.wait ?? waitForDuration

  while (signal.aborted === false) {
    try {
      const result = await processRiskJob({ ...options, signal }, stats)
      if (result.status === 'idle') await wait(pollIntervalMs, signal)
    } catch (error) {
      if (signal.aborted || isAbortError(error)) break
      stats.errors += 1
      try {
        await wait(pollIntervalMs, signal)
      } catch (waitError) {
        if (signal.aborted || isAbortError(waitError)) break
      }
    }
  }
}

/** Create a stoppable worker loop for a service process. */
export function createRiskWorker(options: RiskWorkerOptions): RiskWorkerHandle {
  const controller = new AbortController()
  const linked = linkSignals(options.signal, controller.signal)
  const runOptions: RiskWorkerOptions = { ...options, signal: linked.signal }
  const stats = createStats()
  let running: Promise<RiskWorkerStats> | undefined

  return {
    signal: linked.signal,
    get stats() {
      return snapshotStats(stats)
    },
    run() {
      if (running === undefined) {
        running = runRiskWorkerLoop(runOptions, stats)
          .then(() => snapshotStats(stats))
          .finally(linked.dispose)
      }
      return running
    },
    stop() {
      controller.abort()
    },
  }
}

function createStats(): MutableStats {
  return { claimed: 0, completed: 0, failed: 0, requeued: 0, leaseLost: 0, errors: 0 }
}

function snapshotStats(stats: MutableStats): RiskWorkerStats {
  return { ...stats }
}

async function claim(options: RiskWorkerOptions): Promise<RiskJobRecord | null> {
  if (options.leaseMs === undefined) return options.queue.claim({ workerId: options.workerId })
  return options.queue.claim({ workerId: options.workerId, leaseMs: options.leaseMs })
}

async function requeueAfterAbort(
  options: RiskWorkerOptions,
  job: RiskJobRecord,
  stats: MutableStats | undefined,
): Promise<RiskJobProcessResult> {
  const requeued = await options.queue.requeue({ jobId: job.id, workerId: options.workerId })
  if (requeued === null) {
    if (stats !== undefined) stats.leaseLost += 1
    return { status: 'requeued', job }
  }
  if (stats !== undefined) stats.requeued += 1
  return { status: 'requeued', job: requeued }
}

async function failOwnedJob(
  options: RiskWorkerOptions,
  job: RiskJobRecord,
  error: unknown,
  retryAfterMs: number,
  stats: MutableStats | undefined,
): Promise<RiskJobProcessResult> {
  const message = errorMessage(error)
  const failed = await options.queue.fail({
    jobId: job.id,
    workerId: options.workerId,
    error: message,
    retryAfterMs,
  })
  if (failed === null) {
    if (stats !== undefined) stats.leaseLost += 1
    return { status: 'failed', job, error: message }
  }
  if (stats !== undefined) stats.failed += 1
  return { status: 'failed', job: failed, error: message }
}

function readDuration(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`)
  }
  return value
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function abortError(): Error {
  const error = new Error('risk worker stopped')
  error.name = 'AbortError'
  return error
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
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

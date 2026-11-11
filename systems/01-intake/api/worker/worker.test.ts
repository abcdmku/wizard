import { describe, expect, it } from 'vitest'

import type { RiskJobQueue } from '../db/risk-queue.js'
import type { RiskJobRecord, RiskReviewInput } from '../db/schema.js'
import { assessRisk } from './risk-assessment.js'
import { createRiskWorker, processRiskJob, runRiskWorker } from './worker.js'

const safeInput: RiskReviewInput = {
  requestedAmount: 50_000,
  annualRevenue: 250_000,
  tradingMonths: 48,
  employeeCount: 8,
  revenueDropPercent: 0,
  eligibilityPath: 'standard',
  documentCount: 1,
}

function makeJob(input: RiskReviewInput = safeInput): RiskJobRecord {
  const now = new Date('2026-01-01T00:00:00.000Z')
  return {
    id: 'a2f0b8e7-12d0-4d9e-8a8b-6f9d2ccf52c1',
    applicationId: 'application-1',
    tenantId: 'tenant-1',
    fingerprint: 'fingerprint-1',
    status: 'queued',
    input,
    score: null,
    outcome: null,
    reasons: null,
    createdAt: now,
    updatedAt: now,
    availableAt: now,
    startedAt: null,
    completedAt: null,
    deliveredAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    attemptCount: 0,
    lastError: null,
  }
}

interface FakeQueueState {
  readonly completed: Array<{ readonly workerId: string; readonly score: number }>
  readonly failed: string[]
  readonly requeued: string[]
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = (): void => {
    throw new Error('deferred promise resolved before initialization')
  }
  const promise = new Promise<void>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function fakeQueue(initial: RiskJobRecord | null, state: FakeQueueState): RiskJobQueue {
  let pending = initial
  return {
    async enqueue() {
      throw new Error('not used in worker test')
    },
    async get() {
      return pending
    },
    async getByFingerprint() {
      return pending
    },
    async claim() {
      const claimed = pending
      pending = null
      return claimed === null ? null : { ...claimed, status: 'processing' }
    },
    async complete(input) {
      state.completed.push({ workerId: input.workerId, score: input.score })
      return {
        ...makeJob(),
        status: 'completed',
        score: input.score,
        outcome: input.outcome,
        reasons: input.reasons,
      }
    },
    async fail(input) {
      state.failed.push(input.error)
      return { ...makeJob(), status: 'queued', lastError: input.error }
    },
    async requeue(input) {
      state.requeued.push(input.jobId)
      return { ...makeJob(), status: 'queued' }
    },
    async undelivered() {
      return []
    },
    async markDelivered() {
      return null
    },
  }
}

describe('intake risk assessment', () => {
  it('is deterministic and approves a well-supported standard request', () => {
    expect(assessRisk(safeInput)).toEqual({ score: 90, outcome: 'approved', reasons: [] })
    expect(assessRisk(safeInput)).toEqual(assessRisk(safeInput))
  })

  it('routes weaker inputs to manual review or rejection', () => {
    expect(
      assessRisk({
        ...safeInput,
        requestedAmount: 100_000,
        annualRevenue: 100_000,
        tradingMonths: 12,
        employeeCount: 0,
        revenueDropPercent: 50,
        documentCount: 0,
        eligibilityPath: 'hardship',
      }).outcome,
    ).toBe('rejected')
    expect(assessRisk({ ...safeInput, tradingMonths: 12 }).outcome).toBe('manual-review')
  })
})

describe('risk worker processing', () => {
  it('waits for the configured job duration and completes the claimed job', async () => {
    const state: FakeQueueState = { completed: [], failed: [], requeued: [] }
    const durations: number[] = []
    const result = await processRiskJob({
      queue: fakeQueue(makeJob(), state),
      workerId: 'worker-1',
      wait: async (durationMs) => {
        durations.push(durationMs)
      },
    })

    expect(result.status).toBe('completed')
    expect(durations).toEqual([5_000])
    expect(state.completed).toEqual([{ workerId: 'worker-1', score: 90 }])
  })

  it('requeues an owned job when shutdown interrupts the wait', async () => {
    const state: FakeQueueState = { completed: [], failed: [], requeued: [] }
    const controller = new AbortController()
    const result = await processRiskJob({
      queue: fakeQueue(makeJob(), state),
      workerId: 'worker-1',
      signal: controller.signal,
      wait: async () => {
        controller.abort()
      },
    })

    expect(result.status).toBe('requeued')
    expect(state.requeued).toEqual(['a2f0b8e7-12d0-4d9e-8a8b-6f9d2ccf52c1'])
    expect(state.completed).toEqual([])
  })

  it('stops a polling loop without rejecting', async () => {
    const state: FakeQueueState = { completed: [], failed: [], requeued: [] }
    const controller = new AbortController()
    const stats = await runRiskWorker({
      queue: fakeQueue(null, state),
      workerId: 'worker-1',
      signal: controller.signal,
      wait: async () => controller.abort(),
    })

    expect(stats).toEqual({
      claimed: 0,
      completed: 0,
      failed: 0,
      requeued: 0,
      leaseLost: 0,
      errors: 0,
    })
  })

  it('exposes a synchronous stop handle for active loops', async () => {
    const state: FakeQueueState = { completed: [], failed: [], requeued: [] }
    const worker = createRiskWorker({
      queue: fakeQueue(null, state),
      workerId: 'worker-1',
      wait: async () => undefined,
    })
    const running = worker.run()
    worker.stop()
    await expect(running).resolves.toMatchObject({ completed: 0 })
  })

  it('exposes live stats while a claimed job is still running', async () => {
    const state: FakeQueueState = { completed: [], failed: [], requeued: [] }
    const enteredJobWait = deferred()
    const releaseJob = deferred()
    let stop = (): void => undefined
    const worker = createRiskWorker({
      queue: fakeQueue(makeJob(), state),
      workerId: 'worker-live-stats',
      jobDurationMs: 10,
      pollIntervalMs: 20,
      wait: async (durationMs) => {
        if (durationMs === 10) {
          enteredJobWait.resolve()
          await releaseJob.promise
          return
        }
        stop()
      },
    })
    stop = worker.stop

    const running = worker.run()
    await enteredJobWait.promise
    const duringJob = worker.stats
    expect(duringJob).toMatchObject({ claimed: 1, completed: 0 })

    releaseJob.resolve()
    await expect(running).resolves.toMatchObject({ claimed: 1, completed: 1 })
    expect(worker.stats).toMatchObject({ claimed: 1, completed: 1 })
    expect(duringJob.completed).toBe(0)
  })
})

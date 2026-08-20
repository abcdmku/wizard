import { createRun, type RunEvent } from '@openwizard/core'
import { createTestScheduler } from '@openwizard/core/testing'
import { describe, expect, it } from 'vitest'
import { type Deps, type PostFailure, syncInvoiceFlow } from './sync-invoice'

/** A ledger that fails its first `failures` calls (mutable, so a test can "repair" it), then succeeds. */
function fakeLedger(options: { failures: number }) {
  const state = { calls: 0, failures: options.failures, keys: [] as string[] }
  const deps: Deps = {
    ledger: {
      post: async (invoiceId, _amount, { idempotencyKey }) => {
        state.calls += 1
        state.keys.push(idempotencyKey)
        if (state.calls <= state.failures)
          throw new Error(`ledger unavailable (call ${state.calls})`)
        return { ref: `L-${invoiceId}-${state.calls}` }
      },
    },
  }
  return { deps, state }
}

/** Let the async `run` promises settle (the test scheduler only drives timers). */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function make(deps: Deps) {
  const scheduler = createTestScheduler({ now: 1_000 }) // doubles as the clock
  const run = createRun(syncInvoiceFlow, {
    context: { invoiceId: 'INV-7', amount: 120 },
    deps,
    scheduler: scheduler,
  })
  const events: RunEvent<typeof syncInvoiceFlow>[] = []
  run.observe((event) => events.push(event))
  const eventsOfType = <T extends RunEvent['type']>(type: T) =>
    events.filter(
      (event): event is Extract<RunEvent<typeof syncInvoiceFlow>, { type: T }> =>
        event.type === type,
    )
  return { run, scheduler, events, eventsOfType }
}

describe('02 recoverable failure: exponential retry through the test scheduler', () => {
  it('fails twice, waits 200 ms then 400 ms, and succeeds on attempt 3', async () => {
    const { deps, state } = fakeLedger({ failures: 2 })
    const { run, scheduler, eventsOfType } = make(deps)

    await run.start()
    expect(run.getState().steps.post).toMatchObject({ status: 'active', attempt: 1 })
    await settle()

    // Attempt 1 failed → a retry is scheduled 200 ms later; the deadline is state.
    expect(eventsOfType('step.runFailed')[0]).toMatchObject({ attempt: 1, willRetry: true })
    expect(eventsOfType('step.retryScheduled')[0]).toMatchObject({
      step: 'post',
      attempt: 2,
      dueAt: 1_200,
      timerId: 'retry:post',
    })
    expect(run.getState().steps.post.retryAt).toBe(1_200)
    expect(run.explain('post')).toMatchObject({
      status: 'active',
      phase: 'retrying',
      reasons: ['retrying'],
    })
    expect(scheduler.pending()).toBe(1)

    // Nothing happens before the deadline; at the deadline attempt 2 starts (and fails).
    scheduler.advance(199)
    expect(state.calls).toBe(1)
    scheduler.advance(1)
    expect(state.calls).toBe(2)
    expect(run.getState().steps.post.attempt).toBe(2)
    await settle()
    expect(eventsOfType('step.retryScheduled')[1]).toMatchObject({ attempt: 3, dueAt: 1_600 }) // +400 ms

    // Backoff grows exponentially: 200, 400 (then 800 if it were needed).
    const dueAts = eventsOfType('step.retryScheduled').map((event) => event.dueAt)
    expect(dueAts).toEqual([1_200, 1_600])
    expect(dueAts[1]! - dueAts[0]!).toBe(2 * (dueAts[0]! - 1_000))

    scheduler.advance(400)
    await settle()
    expect(state.calls).toBe(3)
    expect(eventsOfType('step.runSucceeded')[0]).toMatchObject({
      attempt: 3,
      output: { ref: 'L-INV-7-3' },
    })
    expect(run.getState().steps.post).toMatchObject({
      status: 'done',
      attempt: 3,
      output: { ref: 'L-INV-7-3' },
    })
    expect(run.getState().status).toBe('done')
    expect(run.getState().output).toBe('invoice INV-7 posted')
    expect(eventsOfType('timer.fired')).toHaveLength(2)
    expect(scheduler.pending()).toBe(0)
    run.dispose()
  })

  it('halts after retries run out and recovers when the failed step is retried', async () => {
    const { deps, state } = fakeLedger({ failures: Number.POSITIVE_INFINITY })
    const { run, scheduler, eventsOfType } = make(deps)

    await run.start()
    await settle()
    for (const ms of [200, 400, 800]) {
      scheduler.advance(ms)
      await settle()
    }
    // 4 runs (1 + 3 retries), then the step fails for good and the flow halts.
    expect(state.calls).toBe(4)
    expect(eventsOfType('step.runFailed').map((event) => [event.attempt, event.willRetry])).toEqual(
      [
        [1, true],
        [2, true],
        [3, true],
        [4, false],
      ],
    )
    expect(eventsOfType('step.retryScheduled').map((event) => event.dueAt)).toEqual([
      1_200, 1_600, 2_400,
    ])
    expect(eventsOfType('step.failed')[0]).toMatchObject({ step: 'post', kind: 'run' })
    expect(eventsOfType('flow.failed')[0]).toMatchObject({ step: 'post', code: 'STEP_FAILED' })
    expect(run.getState().steps.post).toMatchObject({
      status: 'failed',
      error: { kind: 'run', message: 'ledger unavailable (call 4)' },
    })
    // v0.2 mapError: the failure is also recorded as typed, JSON-safe data.
    const data: PostFailure | undefined = run.getState().steps.post.error?.data
    expect(data).toEqual({ code: 'LEDGER_UNAVAILABLE', attempt: 4 })
    // v0.2 idempotent: every attempt carried the same key (the mapper's value).
    expect(new Set(state.keys)).toEqual(new Set(['invoice:INV-7']))
    expect(run.getState().status).toBe('failed')
    expect(run.explain('post')).toMatchObject({ status: 'failed', reasons: ['failed:run'] })

    // A halt failure is recoverable: navigation is rejected as a value, retry() is accepted.
    expect(await run.next()).toMatchObject({ ok: false, code: 'FLOW_TERMINAL' })
    state.failures = 0 // the ledger is back
    const retried = run.retry('post')
    // The retry command commits synchronously (attempt counter reset); the async run lands later.
    expect(run.getState().steps.post).toMatchObject({ status: 'active', attempt: 1 })
    expect(await retried).toMatchObject({ ok: true })
    await settle()
    expect(state.calls).toBe(5)
    expect(run.getState().steps.post).toMatchObject({
      status: 'done',
      output: { ref: 'L-INV-7-5' },
    })
    expect(run.getState().status).toBe('done')
    // Nothing left to retry.
    expect(await run.retry('post')).toMatchObject({ ok: false })
    run.dispose()
  })
})

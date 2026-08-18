import { createWizard, type WizardEvent } from '@openwizard/core'
import { createTestScheduler } from '@openwizard/core/testing'
import { describe, expect, it } from 'vitest'
import { type Deps, syncInvoice } from './sync-invoice'

/** A ledger that fails its first `failures` calls (mutable, so a test can "repair" it), then succeeds. */
function fakeLedger(opts: { failures: number }) {
  const state = { calls: 0, failures: opts.failures }
  const deps: Deps = {
    ledger: {
      post: async (invoiceId) => {
        state.calls += 1
        if (state.calls <= state.failures)
          throw new Error(`ledger unavailable (call ${state.calls})`)
        return { ref: `L-${invoiceId}-${state.calls}` }
      },
    },
  }
  return { deps, state }
}

/** Let the async `run` promises settle (the test scheduler only drives timers). */
const settle = () => new Promise<void>((r) => setTimeout(r, 0))

function make(deps: Deps) {
  const sched = createTestScheduler({ now: 1_000 }) // doubles as the clock
  const wizard = createWizard(syncInvoice, {
    context: { invoiceId: 'INV-7', amount: 120 },
    deps,
    scheduler: sched,
  })
  const events: WizardEvent<typeof syncInvoice>[] = []
  wizard.observe((e) => events.push(e))
  const of = <T extends WizardEvent['type']>(type: T) =>
    events.filter(
      (e): e is Extract<WizardEvent<typeof syncInvoice>, { type: T }> => e.type === type,
    )
  return { wizard, sched, events, of }
}

describe('02 recoverable failure: exponential retry through the test scheduler', () => {
  it('fails twice, waits 200 ms then 400 ms, and succeeds on attempt 3', async () => {
    const { deps, state } = fakeLedger({ failures: 2 })
    const { wizard, sched, of } = make(deps)

    await wizard.start()
    expect(wizard.getState().steps.post).toMatchObject({ status: 'active', attempt: 1 })
    await settle()

    // Attempt 1 failed → a retry is scheduled 200 ms later; the deadline is state.
    expect(of('step.runFailed')[0]).toMatchObject({ attempt: 1, willRetry: true })
    expect(of('step.retryScheduled')[0]).toMatchObject({
      step: 'post',
      attempt: 2,
      dueAt: 1_200,
      timerId: 'retry:post',
    })
    expect(wizard.getState().steps.post.retryAt).toBe(1_200)
    expect(wizard.explain('post')).toMatchObject({
      status: 'active',
      phase: 'retrying',
      reasons: ['retrying'],
    })
    expect(sched.pending()).toBe(1)

    // Nothing happens before the deadline; at the deadline attempt 2 starts (and fails).
    sched.advance(199)
    expect(state.calls).toBe(1)
    sched.advance(1)
    expect(state.calls).toBe(2)
    expect(wizard.getState().steps.post.attempt).toBe(2)
    await settle()
    expect(of('step.retryScheduled')[1]).toMatchObject({ attempt: 3, dueAt: 1_600 }) // +400 ms

    // Backoff grows exponentially: 200, 400 (then 800 if it were needed).
    const dueAts = of('step.retryScheduled').map((e) => e.dueAt)
    expect(dueAts).toEqual([1_200, 1_600])
    expect(dueAts[1]! - dueAts[0]!).toBe(2 * (dueAts[0]! - 1_000))

    sched.advance(400)
    await settle()
    expect(state.calls).toBe(3)
    expect(of('step.runSucceeded')[0]).toMatchObject({ attempt: 3, output: { ref: 'L-INV-7-3' } })
    expect(wizard.getState().steps.post).toMatchObject({
      status: 'done',
      attempt: 3,
      output: { ref: 'L-INV-7-3' },
    })
    expect(wizard.getState().status).toBe('done')
    expect(wizard.getState().output).toBe('invoice INV-7 posted')
    expect(of('timer.fired')).toHaveLength(2)
    expect(sched.pending()).toBe(0)
    wizard.dispose()
  })

  it('exhausts the retries → step failed (kind run) → flow failed; retry(step) recovers', async () => {
    const { deps, state } = fakeLedger({ failures: Number.POSITIVE_INFINITY })
    const { wizard, sched, of } = make(deps)

    await wizard.start()
    await settle()
    for (const ms of [200, 400, 800]) {
      sched.advance(ms)
      await settle()
    }
    // 4 runs (1 + 3 retries), then the step fails for good and the flow halts.
    expect(state.calls).toBe(4)
    expect(of('step.runFailed').map((e) => [e.attempt, e.willRetry])).toEqual([
      [1, true],
      [2, true],
      [3, true],
      [4, false],
    ])
    expect(of('step.retryScheduled').map((e) => e.dueAt)).toEqual([1_200, 1_600, 2_400])
    expect(of('step.failed')[0]).toMatchObject({ step: 'post', kind: 'run' })
    expect(of('flow.failed')[0]).toMatchObject({ step: 'post', code: 'STEP_FAILED' })
    expect(wizard.getState().steps.post).toMatchObject({
      status: 'failed',
      error: { kind: 'run', message: 'ledger unavailable (call 4)' },
    })
    expect(wizard.getState().status).toBe('failed')
    expect(wizard.explain('post')).toMatchObject({ status: 'failed', reasons: ['failed:run'] })

    // A halt failure is recoverable: navigation is rejected as a value, retry() is accepted.
    expect(await wizard.next()).toMatchObject({ ok: false, code: 'FLOW_TERMINAL' })
    state.failures = 0 // the ledger is back
    const retried = wizard.retry('post')
    // The retry command commits synchronously (attempt counter reset); the async run lands later.
    expect(wizard.getState().steps.post).toMatchObject({ status: 'active', attempt: 1 })
    expect(await retried).toMatchObject({ ok: true })
    await settle()
    expect(state.calls).toBe(5)
    expect(wizard.getState().steps.post).toMatchObject({
      status: 'done',
      output: { ref: 'L-INV-7-5' },
    })
    expect(wizard.getState().status).toBe('done')
    // Nothing left to retry.
    expect(await wizard.retry('post')).toMatchObject({ ok: false })
    wizard.dispose()
  })
})

import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import { defineFlow } from '../../src/authoring/define-flow'
import { createRun } from '../../src/wizard/create-wizard'
import { final, flow, flowStep, task, view } from '../helpers/fixtures'
import { e2e, e2eResume, roundTrip, tick } from './e2e/harness'

describe('terminal run results', () => {
  it('is exposed through the typed createRun facade', async () => {
    const typedResult = defineFlow({ name: 'typed-result', context: boundary.trusted<{}>() })
    const f = typedResult.steps({ end: typedResult.final({ output: () => 'typed' }) })
    const run = createRun(f, { context: {} })
    await run.start()
    expect(run.result()).toMatchObject({ status: 'done', output: 'typed' })
    run.dispose()
  })

  it('resolves and publishes a done result once', async () => {
    const t = e2e(
      flow({
        start: 'work',
        steps: {
          work: task({ run: () => 'ok', next: 'end' }),
          end: final({ output: () => ({ value: 'done' }) }),
        },
      }),
    )
    const results: unknown[] = []
    const off = t.run.subscribeResult((result) => results.push(result))
    const waiting = t.run.awaitResult()
    expect(t.run.result()).toBeUndefined()
    await t.run.start()
    const result = await waiting
    expect(result).toMatchObject({ status: 'done', output: { value: 'done' } })
    expect(t.run.result()).toEqual(result)
    expect(results).toHaveLength(1)
    off()
  })

  it('leaves a recoverable halt pending, then resolves after retry', async () => {
    let fail = true
    const t = e2e(
      flow({
        start: 'work',
        steps: {
          work: task({
            run: () => {
              if (fail) throw new Error('down')
              return 'up'
            },
            next: 'end',
          }),
          end: final(),
        },
      }),
    )
    const waiting = t.run.awaitResult()
    await t.run.start()
    expect(t.run.getState().status).toBe('failed')
    expect(t.run.result()).toBeUndefined()
    fail = false
    await t.run.retry('work')
    expect((await waiting).status).toBe('done')
  })

  it('distinguishes direct cancellation from a compensation failure', async () => {
    const cancelled = e2e(
      flow({
        start: 'wait',
        steps: { wait: view({ next: 'end' }), end: final() },
      }),
    )
    const cancelledWaiting = cancelled.run.awaitResult()
    await cancelled.run.start()
    await cancelled.run.cancel('user stopped')
    await expect(cancelledWaiting).resolves.toMatchObject({
      status: 'cancelled',
      failure: { kind: 'cancelled', reason: 'user stopped' },
    })

    const compensation = e2e(
      flow({
        start: 'first',
        policies: { onFailure: 'compensate' },
        steps: {
          first: task({
            run: () => 'first',
            compensate: () => {
              throw new Error('undo failed')
            },
            next: 'second',
          }),
          second: task({
            run: () => {
              throw new Error('boom')
            },
            next: 'end',
          }),
          end: final(),
        },
      }),
    )
    const failedWaiting = compensation.run.awaitResult()
    await compensation.run.start()
    await expect(failedWaiting).resolves.toMatchObject({
      status: 'failed',
      failure: {
        kind: 'compensation',
        cause: { kind: 'step', step: 'second', error: { message: 'boom' } },
        compensation: {
          outcome: 'failed',
          failures: [{ step: 'first', error: { message: 'undo failed' } }],
        },
      },
    })
  })

  it("retains a task's mapped error data without treating the thrown value as typed", async () => {
    const t = e2e(
      flow({
        start: 'work',
        policies: { onFailure: 'compensate' },
        steps: {
          work: task({
            run: () => {
              throw new Error('raw')
            },
            mapError: () => ({ code: 'MAPPED' }),
          }),
          end: final(),
        },
      }),
    )
    const waiting = t.run.awaitResult()
    await t.run.start()
    await expect(waiting).resolves.toMatchObject({
      status: 'failed',
      failure: { kind: 'step', step: 'work', error: { message: 'raw', data: { code: 'MAPPED' } } },
    })
  })

  it('rejects pending waiters on reset and dispose instead of hanging', async () => {
    const reset = e2e(flow({ start: 'wait', steps: { wait: view({ next: 'end' }), end: final() } }))
    const resetWaiting = reset.run.awaitResult()
    await reset.run.reset()
    await expect(resetWaiting).rejects.toMatchObject({ code: 'RUN_RESET', reason: 'reset' })

    const disposed = e2e(
      flow({ start: 'wait', steps: { wait: view({ next: 'end' }), end: final() } }),
    )
    const disposedWaiting = disposed.run.awaitResult()
    disposed.run.dispose()
    await expect(disposedWaiting).rejects.toMatchObject({
      code: 'RUN_DISPOSED',
      reason: 'disposed',
    })
  })

  it('recovers the exact cancellation result after resume', async () => {
    const def = flow({ start: 'wait', steps: { wait: view({ next: 'end' }), end: final() } })
    const first = e2e(def, { now: 1234 })
    await first.run.start()
    await first.run.cancel('persisted reason')
    const raw = roundTrip(first.run.getSnapshot())
    const resumed = e2eResume(def, raw, { now: 5678 })
    expect(resumed.run.result()).toEqual({
      status: 'cancelled',
      failure: { kind: 'cancelled', reason: 'persisted reason' },
      seq: resumed.run.getState().seq,
      epoch: resumed.run.getState().epoch,
    })
    await expect(resumed.run.awaitResult()).resolves.toMatchObject({
      status: 'cancelled',
      failure: { reason: 'persisted reason' },
    })
    await tick()
  })

  it('exposes the same terminal API on a child run', async () => {
    const child = flow({ start: 'end', steps: { end: final({ output: () => 'child' }) } })
    const parent = flow({
      start: 'child',
      steps: {
        child: flowStep(child, { context: () => ({}), next: 'end' }),
        end: final(),
      },
    })
    const t = e2e(parent)
    const waiting = t.run.awaitResult()
    await t.run.start()
    const childRun = t.run.child('child')
    expect(childRun.result()).toMatchObject({ status: 'done', output: 'child' })
    expect((await childRun.awaitResult()).status).toBe('done')
    expect((await waiting).status).toBe('done')
  })
})

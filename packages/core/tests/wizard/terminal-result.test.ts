import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { defineWizard } from '../../src/wizard/define-wizard'
import { roundTrip, tick } from './e2e/harness'

describe('terminal run results', () => {
  it('is exposed through the typed wizard.create facade', async () => {
    const wizard = defineWizard(
      { name: 'typed-result', context: boundary.trusted<{}>() },
      ({ step, steps }) => steps({ end: step({ run: () => 'typed' }) }),
    )
    const run = wizard.create({})
    await run.start()
    expect(run.result()).toMatchObject({ status: 'done', output: 'typed' })
    run.dispose()
  })

  it('resolves and publishes a done result once', async () => {
    const wizard = defineWizard(
      { name: 'done-result', context: boundary.trusted<{}>() },
      ({ step, steps }) =>
        steps({
          work: step({ run: () => 'ok', next: 'end' }),
          end: step({ run: () => ({ value: 'done' }) }),
        }),
    )
    const run = wizard.create({})
    const results: unknown[] = []
    const off = run.subscribeResult((result) => results.push(result))
    const waiting = run.awaitResult()
    expect(run.result()).toBeUndefined()
    await run.start()
    const result = await waiting
    expect(result).toMatchObject({ status: 'done', output: { value: 'done' } })
    expect(run.result()).toEqual(result)
    expect(results).toHaveLength(1)
    off()
    run.dispose()
  })

  it('leaves a recoverable halt pending, then resolves after retry', async () => {
    let fail = true
    const wizard = defineWizard(
      { name: 'halt-result', context: boundary.trusted<{}>() },
      ({ step, steps }) =>
        steps({
          work: step({
            run: () => {
              if (fail) throw new Error('down')
              return 'up'
            },
            next: 'end',
          }),
          end: step({ next: null }),
        }),
    )
    const run = wizard.create({})
    const waiting = run.awaitResult()
    await run.start()
    expect(run.getState().status).toBe('halted')
    expect(run.result()).toBeUndefined()
    fail = false
    await run.retry('work')
    expect((await waiting).status).toBe('done')
    run.dispose()
  })

  it('distinguishes direct cancellation from a compensation failure', async () => {
    const cancellationWizard = defineWizard(
      { name: 'cancel-result', context: boundary.trusted<{}>() },
      ({ step, view, steps }) =>
        steps({
          wait: view({ next: 'end' }),
          end: step({ next: null }),
        }),
    )
    const cancelled = cancellationWizard.create({})
    const cancelledWaiting = cancelled.awaitResult()
    await cancelled.start()
    await cancelled.cancel('user stopped')
    await expect(cancelledWaiting).resolves.toMatchObject({
      status: 'cancelled',
      failure: { kind: 'cancelled', reason: 'user stopped' },
    })

    const compensationWizard = defineWizard(
      { name: 'compensation-result', context: boundary.trusted<{}>(), onFailure: 'compensate' },
      ({ step, steps }) =>
        steps({
          first: step({
            run: () => 'first',
            compensate: () => {
              throw new Error('undo failed')
            },
            next: 'second',
          }),
          second: step({
            run: () => {
              throw new Error('boom')
            },
            next: 'end',
          }),
          end: step({ next: null }),
        }),
    )
    const compensation = compensationWizard.create({})
    const failedWaiting = compensation.awaitResult()
    await compensation.start()
    await expect(failedWaiting).resolves.toMatchObject({
      status: 'failed',
      failure: {
        kind: 'compensation',
        cause: { kind: 'step', step: 'second', error: { message: 'boom' } },
        compensation: {
          outcome: 'partial',
          failures: [{ step: 'first', error: { message: 'undo failed' } }],
        },
      },
    })
    compensation.dispose()
    cancelled.dispose()
  })

  it("retains a task's mapped error data without treating the thrown value as typed", async () => {
    const wizard = defineWizard(
      { name: 'mapped-result', context: boundary.trusted<{}>(), onFailure: 'compensate' },
      ({ step, steps }) =>
        steps({
          work: step({
            run: () => {
              throw new Error('raw')
            },
            mapError: () => ({ code: 'MAPPED' }),
          }),
          end: step({ next: null }),
        }),
    )
    const run = wizard.create({})
    const waiting = run.awaitResult()
    await run.start()
    await expect(waiting).resolves.toMatchObject({
      status: 'failed',
      failure: { kind: 'step', step: 'work', error: { message: 'raw', data: { code: 'MAPPED' } } },
    })
    run.dispose()
  })

  it('rejects pending waiters on reset and dispose instead of hanging', async () => {
    const wizard = defineWizard(
      { name: 'pending-result', context: boundary.trusted<{}>() },
      ({ step, view, steps }) =>
        steps({
          wait: view({ next: 'end' }),
          end: step({ next: null }),
        }),
    )
    const reset = wizard.create({})
    const resetWaiting = reset.awaitResult()
    await reset.reset()
    await expect(resetWaiting).rejects.toMatchObject({ code: 'RUN_RESET', reason: 'reset' })

    const disposed = wizard.create({})
    const disposedWaiting = disposed.awaitResult()
    disposed.dispose()
    await expect(disposedWaiting).rejects.toMatchObject({
      code: 'RUN_DISPOSED',
      reason: 'disposed',
    })
    reset.dispose()
  })

  it('recovers the exact cancellation result after resume', async () => {
    const wizard = defineWizard(
      { name: 'resumed-result', context: boundary.trusted<{}>() },
      ({ step, view, steps }) =>
        steps({
          wait: view({ next: 'end' }),
          end: step({ next: null }),
        }),
    )
    const first = wizard.create({}, { scheduler: createTestScheduler({ now: 1234 }) })
    await first.start()
    await first.cancel('persisted reason')
    const raw = roundTrip(first.getSnapshot())
    const resumed = wizard.resume(raw, { scheduler: createTestScheduler({ now: 5678 }) })
    expect(resumed.result()).toEqual({
      status: 'cancelled',
      failure: { kind: 'cancelled', reason: 'persisted reason' },
      seq: resumed.getState().seq,
      epoch: resumed.getState().epoch,
    })
    await expect(resumed.awaitResult()).resolves.toMatchObject({
      status: 'cancelled',
      failure: { reason: 'persisted reason' },
    })
    await tick()
    first.dispose()
    resumed.dispose()
  })

  it('exposes the same terminal API on a child run', async () => {
    const child = defineWizard(
      { name: 'child-result', context: boundary.trusted<{}>() },
      ({ step, steps }) => steps({ end: step({ run: () => 'child' }) }),
    )
    const parent = defineWizard(
      { name: 'parent-result', context: boundary.trusted<{}>() },
      ({ step, flow, steps }) =>
        steps({
          child: flow(child, { context: () => ({}), next: 'end' }),
          end: step({ next: null }),
        }),
    )
    const run = parent.create({})
    const waiting = run.awaitResult()
    await run.start()
    const childRun = run.child('child')
    expect(childRun.result()).toMatchObject({ status: 'done', output: 'child' })
    expect((await childRun.awaitResult()).status).toBe('done')
    expect((await waiting).status).toBe('done')
    run.dispose()
  })
})

import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import { defineWizard } from '../../src/wizard/define-wizard'

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let release = (): void => {}
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, resolve: release }
}

describe('wait handler lifecycle', () => {
  it('rejects boundary and terminal sends before invoking the handler', async () => {
    let calls = 0
    const wizard = defineWizard(
      {
        name: 'wait-handler-gates',
        context: boundary.trusted<{}>(),
        events: {
          tick: boundary.guard<{ readonly by: number }>(
            (value): value is { readonly by: number } =>
              typeof value === 'object' &&
              value !== null &&
              'by' in value &&
              typeof value.by === 'number',
          ),
        },
      },
      ({ step, steps }) =>
        steps({
          waiting: step({
            waitFor: {
              tick: () => {
                calls += 1
                return { done: undefined }
              },
            },
          }),
        }),
    )
    const run = wizard.create({})
    await run.start()
    expect(await run.send('tick', { by: 'bad' } as never)).toMatchObject({
      ok: false,
      code: 'BOUNDARY_REJECTED',
    })
    expect(calls).toBe(0)
    expect(await run.send('tick', { by: 1 })).toMatchObject({ ok: true })
    expect(calls).toBe(1)
    expect(await run.send('tick', { by: 2 })).toMatchObject({
      ok: false,
      code: 'RUN_TERMINAL',
    })
    expect(calls).toBe(1)
  })

  it('settles active entry work after a recoverable resume failure and remains retryable', async () => {
    const enterGate = deferred()
    let enterCalls = 0
    let handlerCalls = 0
    let runs = 0
    const wizard = defineWizard(
      {
        name: 'resume-failure-freeze',
        context: boundary.trusted<{ readonly count: number }>(),
        events: { tick: boundary.trusted<{}>() },
      },
      ({ step, steps }) =>
        steps(
          {
            work: step({
              run: () => {
                runs += 1
                return runs === 1 ? new Promise<never>(() => {}) : undefined
              },
            }),
            waiting: step({
              enter: () => {
                enterCalls += 1
                return enterGate.promise
              },
              waitFor: {
                tick: ({ update }) => {
                  handlerCalls += 1
                  update((current) => ({ count: current.count + 1 }))
                  return { keep: true }
                },
              },
            }),
          },
          { start: ['work', 'waiting'] },
        ),
    )
    const original = wizard.create({ count: 0 })
    await original.start()
    await original.whenIdle()
    expect(await original.send('tick', {})).toMatchObject({ buffered: true })
    const snapshot = JSON.parse(JSON.stringify(original.getSnapshot())) as unknown
    original.dispose()

    const resumed = wizard.resume(snapshot)
    await resumed.whenIdle()
    expect(resumed.log().map((event) => event.type)).toEqual([
      'run.resumed',
      'step.failed',
      'run.halted',
    ])
    expect(enterCalls).toBe(2)
    enterGate.resolve()
    await Promise.resolve()
    await resumed.whenIdle()
    expect(handlerCalls).toBe(1)
    expect(resumed.getState().context).toEqual({ count: 1 })
    expect(resumed.getState().status).toBe('halted')
    expect(await resumed.retry('work')).toMatchObject({ ok: true })
    await resumed.whenIdle()
    expect(runs).toBe(2)
    expect(resumed.getState().steps.waiting?.entering).not.toBe(true)
    expect(resumed.getState().status).toBe('waiting')
  })
})

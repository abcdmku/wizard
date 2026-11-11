import { describe, expect, it } from 'vitest'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import type { DomainEvent } from '../../src/machine/events'
import { initialState, machine } from '../../src/machine/index'
import { createWizardRuntime } from '../../src/wizard/runtime'
import { createHarness, flow, of, view } from '../helpers/fixtures'

describe('navigation cancellation', () => {
  it.each(['canExit', 'canEnter', 'exit', 'enter'] as const)(
    'cancel closes an open %s transaction before late hook results arrive',
    (hook) => {
      const h = createHarness(
        flow({
          start: 'a',
          steps: {
            a: view({
              next: 'b',
              ...(hook === 'canExit' ? { canExit: () => true } : {}),
              ...(hook === 'exit' ? { exit: () => undefined } : {}),
            }),
            b: view({
              ...(hook === 'canEnter' ? { canEnter: () => true } : {}),
              ...(hook === 'enter' ? { enter: () => undefined } : {}),
            }),
          },
        }),
      )
      h.start()
      const navigation = h.cmd('next')
      const call = h.call(hook)
      const txId = of(navigation, 'transition.started')[0]?.txId

      const cancelled = h.cmd({ type: 'cancel', reason: 'owner stopped' })

      expect(cancelled.types).toEqual(['transition.failed', 'step.cancelled', 'flow.cancelled'])
      expect(of(cancelled, 'transition.failed')[0]).toMatchObject({
        txId,
        step: 'a',
        error: { name: 'AbortError', code: 'CANCELLED', message: 'navigation cancelled' },
      })
      expect(cancelled.effects).toContainEqual({
        kind: 'settle',
        txId,
        outcome: 'failed',
        error: { name: 'AbortError', code: 'CANCELLED', message: 'navigation cancelled' },
      })
      expect(h.state.nav.phase).toBe('idle')
      expect(h.state.status).toBe('cancelled')
      expect(h.rec('b').status).toBe('idle')
      expect(h.rec('b').entering).toBeUndefined()
      expect(h.rec('b').enterDone).toBeUndefined()

      const late = h.ok(call, true)
      expect(late.types).toEqual(['result.ignored'])
      expect(h.rec('a').guards.canExit).toBeUndefined()
      expect(h.rec('b').guards.canEnter).toBeUndefined()
      expect(h.log.filter((event) => event.type === 'transition.committed')).toHaveLength(1)
    },
  )

  it('an aborted guard result fails navigation without recording a guard verdict', () => {
    const h = createHarness(
      flow({ start: 'a', steps: { a: view({ next: 'b', canExit: () => true }), b: view() } }),
    )
    h.start()
    h.cmd('next')
    const call = h.call('canExit')

    const aborted = h.step({
      type: 'res.err',
      effectId: call.effectId,
      hook: call.hook,
      token: call.token,
      error: { name: 'AbortError', code: 'ABORTED', message: 'cancelled' },
      cancelled: true,
      durationMs: 0,
    })

    expect(aborted.types).toEqual(['transition.failed'])
    expect(of(aborted, 'transition.failed')[0]?.error).toEqual({
      name: 'AbortError',
      code: 'CANCELLED',
      message: 'navigation cancelled',
    })
    expect(h.rec('a').guards.canExit).toBeUndefined()
    expect(h.state.current).toBe('a')
    expect(h.state.nav.phase).toBe('idle')
  })

  it('cancel also closes the initial cursor transaction before the first view enters', () => {
    const h = createHarness(flow({ start: 'a', steps: { a: view({ canEnter: () => true }) } }))
    h.start()
    const call = h.call('canEnter')

    const cancelled = h.cmd('cancel')

    expect(cancelled.types).toEqual(['transition.failed', 'flow.cancelled'])
    expect(of(cancelled, 'transition.failed')[0]?.step).toBe('a')
    expect(h.state.nav.phase).toBe('idle')
    expect(h.state.current).toBeNull()
    expect(h.ok(call, true).types).toEqual(['result.ignored'])
    expect(h.rec('a').guards.canEnter).toBeUndefined()
  })

  it.each(['canEnter', 'enter'] as const)(
    'cancel aborts an in-flight target %s signal and settles next without a guard verdict',
    async (hook) => {
      let signal: AbortSignal | undefined
      let finish = (_value: boolean): void => {}
      const pending = new Promise<boolean>((resolve) => {
        finish = resolve
      })
      const def = flow({
        start: 'a',
        steps: {
          a: view({ next: 'b' }),
          b: view(
            hook === 'canEnter'
              ? {
                  canEnter: (args) => {
                    signal = args.signal
                    return pending
                  },
                }
              : {
                  enter: (args) => {
                    signal = args.signal
                    return pending.then(() => undefined)
                  },
                },
          ),
        },
      })
      const run = createWizardRuntime(def, {
        context: {},
        machine,
        initialState,
        scheduler: createTestScheduler(),
      })
      const events: DomainEvent[] = []
      run.observe((event) => events.push(event))
      try {
        await run.start()
        const navigation = run.next()
        expect(signal?.aborted).toBe(false)

        await run.cancel()

        expect(signal?.aborted).toBe(true)
        expect(await navigation).toMatchObject({
          ok: false,
          code: 'CANCELLED',
          reason: 'failed',
          message: 'navigation cancelled',
          error: { name: 'AbortError', code: 'CANCELLED', message: 'navigation cancelled' },
        })
        finish(true)
        await pending
        await run.whenIdle()
        expect(events.filter((event) => event.type === 'step.guardEvaluated')).toEqual([])
        expect(run.getState().steps.b?.status).toBe('idle')
        expect(run.getState().status).toBe('cancelled')
      } finally {
        finish(true)
        run.dispose()
      }
    },
  )
})

describe('navigation hook contracts', () => {
  it('exit receives its destination without a direction extra', () => {
    const h = createHarness(
      flow({ start: 'a', steps: { a: view({ next: 'b', exit: () => undefined }), b: view() } }),
    )
    h.start()
    h.cmd('next')

    expect(h.call('exit').extra).toEqual({ to: 'b' })
  })

  it('an actual false guard still records its verdict and rejects navigation', () => {
    const h = createHarness(
      flow({ start: 'a', steps: { a: view({ next: 'b', canExit: () => false }), b: view() } }),
    )
    h.start()
    h.cmd('next')

    const blocked = h.ok(h.call('canExit'), false)

    expect(blocked.types).toEqual(['step.guardEvaluated', 'transition.rejected'])
    expect(h.rec('a').guards.canExit?.ok).toBe(false)
    expect(of(blocked, 'transition.rejected')[0]?.reason).toBe('guard-canExit')
  })

  it('a dynamic view route cannot select an existing undeclared target', () => {
    const a = view({ dynamicNext: () => 'b' })
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: { ...a, next: { kind: 'dynamic', targets: ['b'] } },
          b: view(),
          outside: view(),
        },
      }),
    )
    h.start()
    h.cmd('next')

    const rejected = h.ok(h.call('next'), 'outside')

    expect(rejected.types).toEqual(['transition.failed'])
    expect(of(rejected, 'transition.failed')[0]?.error).toEqual({
      name: 'WizardError',
      code: 'UNDECLARED_TARGET',
      message: "next() of 'a' selected undeclared target 'outside'",
    })
    expect(h.state.current).toBe('a')
    expect(h.rec('b').status).toBe('idle')
    expect(h.rec('outside').status).toBe('idle')
  })

  it('a malformed dynamic result fails instead of silently dropping invalid targets', () => {
    const a = view({ dynamicNext: () => 'b' })
    const h = createHarness(
      flow({
        start: 'a',
        steps: { a: { ...a, next: { kind: 'dynamic', targets: ['b'] } }, b: view() },
      }),
    )
    h.start()
    h.cmd('next')

    const rejected = h.ok(h.call('next'), ['b', 42])

    expect(rejected.types).toEqual(['transition.failed'])
    expect(of(rejected, 'transition.failed')[0]?.error.code).toBe('INVALID_NEXT_TARGET')
    expect(h.state.current).toBe('a')
    expect(h.rec('b').status).toBe('idle')
  })

  it('a branch is excluded only when navigation commits, including its unreachable descendants', () => {
    const a = view({ dynamicNext: () => 'b' })
    const h = createHarness(
      flow({
        start: 'a',
        steps: {
          a: { ...a, next: { kind: 'dynamic', targets: ['b', 'c'] } },
          b: view({ canEnter: () => true }),
          c: view({ next: 'tail' }),
          tail: view(),
        },
      }),
    )
    h.start()
    h.cmd('next')
    h.ok(h.call('next'), 'b')
    h.ok(h.call('canEnter'), false)

    expect(h.rec('c').status).toBe('idle')
    expect(h.rec('tail').status).toBe('idle')

    h.cmd('next')
    h.ok(h.call('next'), 'b')
    const committed = h.ok(h.call('canEnter'), true)

    expect(of(committed, 'step.skipped').map((event) => [event.step, event.reason])).toEqual([
      ['c', 'not-taken'],
      ['tail', 'not-taken'],
    ])
    expect(h.state.current).toBe('b')
    expect(h.rec('c').pendingActivation).toBe(false)
    expect(h.rec('tail').pendingActivation).toBe(false)
    expect(h.state.nav.deferred).toBeUndefined()
  })

  it('leaving a producer view activates its data join without an explicit next edge', () => {
    const def = flow({
      start: 'a',
      steps: {
        a: view({ initial: { value: 7 } }),
        join: { ...view(), needs: { value: { kind: 'all', steps: ['a'] } } },
      },
    })
    const h = createHarness({ ...def, feeds: { a: ['join'] } })
    h.start()

    const advanced = h.cmd('next')

    expect(h.rec('a').status).toBe('done')
    expect(h.rec('a').output).toEqual({ value: 7 })
    expect(h.state.current).toBe('join')
    expect(of(advanced, 'step.arrived').filter((event) => event.step === 'join')).toHaveLength(1)
  })

  it('a routing step preserves every chosen target when its auto-advance is deferred', () => {
    const h = createHarness(
      flow({
        start: ['a', 'route'],
        steps: {
          a: view({ canExit: () => true }),
          route: {
            ...view(),
            kind: 'step',
            next: { kind: 'dynamic', targets: ['b', 'c'] },
            hooks: { next: () => ['b', 'c'] },
          },
          b: view(),
          c: view(),
        },
      }),
    )
    h.start()
    h.cmd('next')

    expect(h.rec('route').status).toBe('active')
    h.ok(h.call('next', 'route'), ['b', 'c'])

    expect(h.rec('route').status).toBe('done')
    expect(h.rec('route').output).toBeUndefined()
    expect(h.state.nav.deferred).toEqual([{ step: 'route', to: ['b', 'c'] }])

    h.ok(h.call('canExit'), true)

    expect(h.state.current).toBe('b')
    expect(h.rec('c').pendingActivation).toBe(true)
    expect(h.state.nav.deferred).toBeUndefined()
    expect(
      h.log.filter((event) => event.type === 'step.arrived' && event.step === 'c'),
    ).toHaveLength(1)
  })
})

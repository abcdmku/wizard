/**
 * End-to-end with the REAL machine through `createWizardRuntime`: runtime methods (`skip`,
 * `invalidate`, `attach`, `progress`, `readyViews`), the `correlationId` option, and `on` on
 * views / flow level with real hooks.
 */
import { describe, expect, it } from 'vitest'
import {
  eventStep,
  flow,
  flowStep,
  guard,
  needAll,
  needOptional,
  routingStep,
  runStep,
  view,
} from '../../helpers/fixtures'
import { e2e, tick } from './harness'

const on = () => undefined
const anyEvent = { guard: guard(() => true) }

describe('e2e — external events on every kind, flow-level, correlation, attach()', () => {
  it('a view handler returning { next } advances the cursor (cause event) without validation; SendResult lists the view', async () => {
    const def = flow({
      name: 'view-on',
      start: 'form',
      events: { 'payment.captured': anyEvent.guard },
      steps: {
        form: view({
          input: guard(() => false, 'never valid'), // validation would fail — events skip it
          on: {
            'payment.captured': ({ payload, update }) => {
              update({ paymentId: (payload as { id: string }).id })
              return { next: 'receipt' }
            },
          },
          next: 'receipt',
        }),
        receipt: runStep({ run: ({ context }) => context }),
      },
    })
    const t = e2e(def)
    await t.run.start()
    expect(await t.run.next()).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    const sent = await t.run.send('payment.captured', { id: 'p1' })
    expect(sent).toMatchObject({ ok: true, delivered: ['form'], buffered: false })
    expect(t.of('transition.committed').at(-1)).toMatchObject({
      from: 'form',
      to: 'receipt',
      cause: 'event',
    })
    expect(t.run.getState().status).toBe('done')
    expect(t.run.getState().output).toEqual({ paymentId: 'p1' })
  })

  it('flow-level on: handled without a step (SendResult ok, delivered []), { cancel } cancels the flow, correlate + correlationId drop foreign events', async () => {
    const seen: string[] = []
    const def = flow({
      name: 'flow-on',
      start: 'w',
      events: { note: anyEvent.guard, abort: anyEvent.guard, paid: anyEvent.guard },
      correlate: { paid: (p) => (p as { orderId: string }).orderId },
      on: {
        note: ({ payload }) => {
          seen.push(String(payload))
        },
        abort: ({ payload }) => ({ cancel: `abort:${String(payload)}` }),
      },
      steps: { w: eventStep({ on: { paid: on }, next: 'end' }), end: routingStep() },
    })
    const t = e2e(def, { correlationId: 'order-9' })
    expect(t.run.getState().correlationId).toBe('order-9')
    expect(t.run.getSnapshot().state.correlationId).toBe('order-9')
    await t.run.start()
    expect(await t.run.send('note', 'hi')).toMatchObject({
      ok: true,
      delivered: [],
      buffered: false,
    })
    expect(seen).toEqual(['hi'])
    expect(await t.run.send('paid', { orderId: 'order-1' })).toMatchObject({
      ok: false,
      reason: 'dropped',
      message: "'paid' belongs to another run (its correlation id does not match this run's)",
    })
    expect(t.run.getState().inbox).toEqual([])
    expect(await t.run.send('abort', 'ops')).toMatchObject({ ok: true })
    expect(t.run.getState().status).toBe('cancelled')
    expect(t.of('flow.cancelled')[0]).toMatchObject({ reason: 'abort:ops' })
  })

  it('a child flow inherits the parent correlationId', async () => {
    const child = flow({
      name: 'child',
      start: 'v',
      steps: { v: view({ next: 'e' }), e: routingStep() },
    })
    const parent = flow({
      name: 'parent',
      start: 'f',
      steps: { f: flowStep(child, { next: 'end' }), end: routingStep() },
    })
    const t = e2e(parent, { correlationId: 'corr' })
    await t.run.start()
    expect(t.run.child('f').getState().correlationId).toBe('corr')
  })

  it('attach(source): the source gets send(); its disposer runs on dispose() (or when the returned function is called)', async () => {
    const def = flow({
      name: 'attach',
      start: 'w',
      events: { tick: anyEvent.guard },
      steps: {
        w: eventStep({ on: { tick: () => ({ keep: true }) }, next: 'end' }),
        end: routingStep(),
      },
    })
    const t = e2e(def)
    await t.run.start()
    let detached = 0
    let emit: ((n: number) => void) | undefined
    const detach = t.run.attach((send) => {
      emit = (n) => void send('tick', n)
      return () => {
        detached += 1
      }
    })
    emit?.(1)
    expect(t.of('event.delivered')).toHaveLength(1)
    // manual detach is idempotent and not called again on dispose
    detach()
    detach()
    expect(detached).toBe(1)
    let second = 0
    t.run.attach(() => () => {
      second += 1
    })
    // a source returning nothing is tolerated
    t.run.attach(() => undefined as unknown as () => void)
    t.run.dispose()
    expect(second).toBe(1)
    expect(detached).toBe(1)
  })
})

describe('e2e — skip / invalidate / progress / readyViews', () => {
  const dag = () =>
    flow({
      name: 'dag',
      start: 'a',
      steps: {
        a: view({ next: 'load' }),
        load: runStep({ run: () => 'loaded', next: 'b' }),
        b: view({ needs: needAll('load'), next: ['t1', 't2'] }),
        t1: runStep({ run: () => 't1', needs: needAll('load', 'b'), next: 'c' }),
        t2: runStep({ run: () => new Promise(() => {}), next: 'c' }),
        c: view({ needs: { ...needAll('t1'), ...needOptional('t2') }, next: 'end' }),
        end: routingStep(),
      },
    })

  it('progress() and readyViews() follow the run; skip() unblocks a slow step; invalidate() cascades and rejects active steps', async () => {
    const t = e2e(dag())
    expect(t.run.progress()).toEqual({ done: 0, total: 7, ratio: 0 })
    expect(t.run.readyViews()).toEqual([])
    await t.run.start()
    expect(t.run.readyViews()).toEqual(['a'])
    await t.run.next()
    expect(t.run.progress()).toEqual({ done: 2, total: 7, ratio: 2 / 7 })
    expect(t.run.readyViews()).toEqual(['b'])
    await t.run.next() // t1 done (sync), t2 hangs; c blocked
    expect(t.rec('t2').status).toBe('active')
    expect(t.run.readyViews()).toEqual([])
    expect(await t.run.skip('t2', 'too slow')).toMatchObject({ ok: true })
    expect(t.rec('t2')).toMatchObject({ status: 'skipped', skipReason: 'command' })
    expect(t.run.getState().current).toBe('c') // needs satisfied → cursor moved
    expect(t.run.progress()).toEqual({ done: 5, total: 7, ratio: 5 / 7 }) // skipped counts
    // invalidate: active/current rejected, done cascades
    expect(await t.run.invalidate('c')).toMatchObject({
      ok: false,
      code: 'INVALID_COMMAND',
      message: "'c' is the current view; navigate away before invalidating it",
      step: 'c',
    })
    expect(await t.run.invalidate('load')).toMatchObject({ ok: true })
    expect(t.rec('load')).toMatchObject({ status: 'idle', previousOutput: 'loaded' })
    expect(t.rec('b').status).toBe('idle')
    expect(t.rec('t1').status).toBe('idle')
    expect(t.rec('c').status).toBe('idle') // cancelled + invalidated (it depended transitively)
    expect(t.rec('t2').status).toBe('skipped') // does not need load
    expect(t.run.getState().current).toBeNull()
    expect(t.run.progress()).toEqual({ done: 2, total: 7, ratio: 2 / 7 })
    // cascade: false leaves dependents alone
    await t.run.go('a')
    await t.run.next()
    await tick()
    expect(t.rec('load').status).toBe('done')
    expect(await t.run.invalidate('load', { cascade: false })).toMatchObject({ ok: true })
    expect(t.rec('load').status).toBe('idle')
    // and once done the ratio is 1 (branches not taken do not count against a finished flow)
    const done = e2e(dag())
    await done.run.start()
    await done.run.next()
    await done.run.next()
    await done.run.skip('t2')
    await done.run.next()
    expect(done.run.getState().status).toBe('done')
    expect(done.run.progress()).toEqual({ done: 7, total: 7, ratio: 1 })
  })

  it('rejects an idle sink, unknown steps and malformed cascade commands', async () => {
    const t = e2e(dag())
    await t.run.start()
    expect(await t.run.skip('end')).toMatchObject({
      ok: false,
      code: 'NOT_ACTIVE',
      message: "'end' is idle; only a ready or active step can be skipped",
    })
    expect(await t.run.skip('nope')).toMatchObject({ ok: false, code: 'UNKNOWN_STEP' })
    expect(await t.run.dispatch({ type: 'skip', step: 'a' })).toMatchObject({ ok: true })
    expect(
      await t.run.dispatch({ type: 'invalidate', step: 'a', cascade: 'yes' as never }),
    ).toMatchObject({ ok: false, code: 'INVALID_COMMAND', message: 'invalid command shape' })
    expect(await t.run.dispatch({ type: 'invalidate', step: 'a', cascade: false })).toMatchObject({
      ok: true,
    })
  })

  it('can skip a ready sink and finish without output', async () => {
    const t = e2e(
      flow({
        start: 'end',
        policies: { autoRun: 'manual' },
        steps: { end: runStep({ run: () => 'unused' }) },
      }),
    )
    await t.run.start()
    expect(await t.run.skip('end')).toMatchObject({ ok: true })
    expect(t.rec('end')).toMatchObject({ status: 'skipped', skipReason: 'command' })
    expect(t.run.getState().status).toBe('done')
    expect(t.run.getState().output).toBeUndefined()
  })

  it('when: false on a step skips it in the same drain as readiness (sync predicate); an async predicate resolves later', async () => {
    let asked = 0
    const def = flow({
      name: 'when',
      start: 'v',
      steps: {
        v: view({ next: ['sync', 'async'] }),
        sync: runStep({
          when: ({ context }) => {
            asked += 1
            return (context as { pro?: boolean }).pro === true
          },
          run: () => 'ran',
          next: 'join',
        }),
        async: runStep({ when: () => Promise.resolve(false), run: () => 'ran', next: 'join' }),
        join: runStep({ needs: needOptional('sync', 'async'), run: () => 'j', next: 'end' }),
        end: routingStep(),
      },
    })
    const t = e2e(def)
    await t.run.start()
    const nav = t.run.next() // sync commit: inspect before yielding to the microtask queue
    expect(asked).toBe(1)
    expect(t.rec('sync')).toMatchObject({ status: 'skipped', skipReason: 'when' })
    expect(t.rec('async')).toMatchObject({ status: 'idle', when: 'pending' })
    expect(t.run.explain('async').reasons).toEqual(['when-pending'])
    await nav
    await tick()
    expect(t.rec('async').status).toBe('skipped')
    expect(t.rec('join').status).toBe('done')
    expect(t.run.getState().status).toBe('done')
  })
})

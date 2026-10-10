/**
 * v0.2 end-to-end with the REAL machine through `createWizardRuntime` /
 * `resumeWizardRuntime`: runtime methods (`skip`, `invalidate`, `attach`,
 * `progress`, `readyViews`), the `correlationId` option, `on` on views / flow
 * level with real hooks, `mapError` data (raw error, persistence check),
 * idempotent crash-resume, and `migrate`.
 */
import { describe, expect, it } from 'vitest'
import { WizardError } from '../../../src/errors'
import { final, flow, flowStep, guard, task, view, wait } from '../../helpers/fixtures'
import { e2e, tick } from './harness'

const on = () => undefined
const anyEvent = { guard: guard(() => true) }

describe('e2e v0.2 — external events on every kind, flow-level, correlation, attach()', () => {
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
        receipt: final({ output: ({ context }) => context }),
      },
    })
    const t = e2e(def)
    await t.wizard.start()
    expect(await t.wizard.next()).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    const sent = await t.wizard.send('payment.captured', { id: 'p1' })
    expect(sent).toMatchObject({ ok: true, delivered: ['form'], buffered: false })
    expect(t.of('transition.committed').at(-1)).toMatchObject({
      from: 'form',
      to: 'receipt',
      cause: 'event',
    })
    expect(t.wizard.getState().status).toBe('done')
    expect(t.wizard.getState().output).toEqual({ paymentId: 'p1' })
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
      steps: { w: wait({ on: { paid: on }, next: 'end' }), end: final() },
    })
    const t = e2e(def, { correlationId: 'order-9' })
    expect(t.wizard.getState().correlationId).toBe('order-9')
    expect(t.wizard.getSnapshot().state.correlationId).toBe('order-9')
    await t.wizard.start()
    expect(await t.wizard.send('note', 'hi')).toMatchObject({
      ok: true,
      delivered: [],
      buffered: false,
    })
    expect(seen).toEqual(['hi'])
    expect(await t.wizard.send('paid', { orderId: 'order-1' })).toMatchObject({
      ok: false,
      reason: 'dropped',
      message: 'correlation',
    })
    expect(t.wizard.getState().inbox).toEqual([])
    expect(await t.wizard.send('abort', 'ops')).toMatchObject({ ok: true })
    expect(t.wizard.getState().status).toBe('cancelled')
    expect(t.of('flow.cancelled')[0]).toMatchObject({ reason: 'abort:ops' })
  })

  it('a child flow inherits the parent correlationId', async () => {
    const child = flow({
      name: 'child',
      start: 'v',
      steps: { v: view({ next: 'e' }), e: final() },
    })
    const parent = flow({
      name: 'parent',
      start: 'f',
      steps: { f: flowStep(child, { next: 'end' }), end: final() },
    })
    const t = e2e(parent, { correlationId: 'corr' })
    await t.wizard.start()
    expect(t.wizard.child('f').getState().correlationId).toBe('corr')
  })

  it('attach(source): the source gets send(); its disposer runs on dispose() (or when the returned function is called); after dispose attach throws', async () => {
    const def = flow({
      name: 'attach',
      start: 'w',
      events: { tick: anyEvent.guard },
      steps: { w: wait({ on: { tick: () => ({ keep: true }) }, next: 'end' }), end: final() },
    })
    const t = e2e(def)
    await t.wizard.start()
    let detached = 0
    let emit: ((n: number) => void) | undefined
    const detach = t.wizard.attach((send) => {
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
    t.wizard.attach(() => () => {
      second += 1
    })
    // a source returning nothing is tolerated
    t.wizard.attach(() => undefined as unknown as () => void)
    t.wizard.dispose()
    expect(second).toBe(1)
    expect(detached).toBe(1)
    expect(() => t.wizard.attach(() => () => {})).toThrow(WizardError)
  })
})

describe('e2e v0.2 — skip / invalidate / progress / readyViews', () => {
  const dag = () =>
    flow({
      name: 'dag',
      start: 'a',
      steps: {
        a: view({ next: 'load' }),
        load: task({ run: () => 'loaded', next: 'b' }),
        b: view({ dependsOn: ['load'], next: ['t1', 't2'] }),
        t1: task({ run: () => 't1', dependsOn: ['load'], next: 'c' }),
        t2: task({ run: () => new Promise(() => {}), next: 'c' }),
        c: view({ dependsOn: ['t1', 't2'], next: 'end' }),
        end: final(),
      },
    })

  it('progress() and readyViews() follow the run; skip() unblocks a slow task; invalidate() cascades and rejects active steps', async () => {
    const t = e2e(dag())
    expect(t.wizard.progress()).toEqual({ done: 0, total: 6, ratio: 0 })
    expect(t.wizard.readyViews()).toEqual([])
    await t.wizard.start()
    expect(t.wizard.readyViews()).toEqual(['a'])
    await t.wizard.next()
    expect(t.wizard.progress()).toEqual({ done: 2, total: 6, ratio: 2 / 6 })
    expect(t.wizard.readyViews()).toEqual(['b'])
    await t.wizard.next() // t1 done (sync), t2 hangs; c blocked
    expect(t.rec('t2').status).toBe('active')
    expect(t.wizard.readyViews()).toEqual([])
    expect(await t.wizard.skip('t2', 'too slow')).toMatchObject({ ok: true })
    expect(t.rec('t2')).toMatchObject({ status: 'skipped', skipReason: 'command' })
    expect(t.wizard.getState().current).toBe('c') // deps satisfied → cursor moved
    expect(t.wizard.progress()).toEqual({ done: 5, total: 6, ratio: 5 / 6 }) // skipped counts
    // invalidate: active/current rejected, done cascades
    expect(await t.wizard.invalidate('c')).toMatchObject({
      ok: false,
      code: 'INVALID_COMMAND',
      message: 'current-view',
      step: 'c',
    })
    expect(await t.wizard.invalidate('load')).toMatchObject({ ok: true })
    expect(t.rec('load')).toMatchObject({ status: 'idle', previousOutput: 'loaded' })
    expect(t.rec('b').status).toBe('idle')
    expect(t.rec('t1').status).toBe('idle')
    expect(t.rec('c').status).toBe('idle') // cancelled + invalidated (it depended transitively)
    expect(t.rec('t2').status).toBe('skipped') // no dependsOn on load
    expect(t.wizard.getState().current).toBeNull()
    expect(t.wizard.progress()).toEqual({ done: 2, total: 6, ratio: 2 / 6 })
    // cascade: false leaves dependents alone
    await t.wizard.go('a')
    await t.wizard.next()
    await tick()
    expect(t.rec('load').status).toBe('done')
    expect(await t.wizard.invalidate('load', { cascade: false })).toMatchObject({ ok: true })
    expect(t.rec('load').status).toBe('idle')
    // and once done the ratio is 1 (branches not taken do not count against a finished flow)
    const done = e2e(dag())
    await done.wizard.start()
    await done.wizard.next()
    await done.wizard.next()
    await done.wizard.skip('t2')
    await done.wizard.next()
    expect(done.wizard.getState().status).toBe('done')
    expect(done.wizard.progress()).toEqual({ done: 6, total: 6, ratio: 1 })
  })

  it('skip rejections and dispatch shapes: final step, unknown step, malformed cascade', async () => {
    const t = e2e(dag())
    await t.wizard.start()
    expect(await t.wizard.skip('end')).toMatchObject({
      ok: false,
      code: 'INVALID_COMMAND',
      message: 'final-step',
    })
    expect(await t.wizard.skip('nope')).toMatchObject({ ok: false, code: 'UNKNOWN_STEP' })
    expect(await t.wizard.dispatch({ type: 'skip', step: 'a' })).toMatchObject({ ok: true })
    expect(
      await t.wizard.dispatch({ type: 'invalidate', step: 'a', cascade: 'yes' as never }),
    ).toMatchObject({ ok: false, code: 'INVALID_COMMAND', message: 'invalid command shape' })
    expect(
      await t.wizard.dispatch({ type: 'invalidate', step: 'a', cascade: false }),
    ).toMatchObject({ ok: true })
  })

  it('when: false on a task skips it in the same drain as readiness (sync predicate); an async predicate resolves later', async () => {
    let asked = 0
    const def = flow({
      name: 'when',
      start: 'v',
      steps: {
        v: view({ next: ['sync', 'async'] }),
        sync: task({
          when: ({ context }) => {
            asked += 1
            return (context as { pro?: boolean }).pro === true
          },
          run: () => 'ran',
          next: 'join',
        }),
        async: task({ when: () => Promise.resolve(false), run: () => 'ran', next: 'join' }),
        join: task({ dependsOn: ['sync', 'async'], run: () => 'j', next: 'end' }),
        end: final(),
      },
    })
    const t = e2e(def)
    await t.wizard.start()
    const nav = t.wizard.next() // sync commit: inspect before yielding to the microtask queue
    expect(asked).toBe(1)
    expect(t.rec('sync')).toMatchObject({ status: 'skipped', skipReason: 'when' })
    expect(t.rec('async')).toMatchObject({ status: 'idle', when: 'pending' })
    expect(t.wizard.explain('async').reasons).toEqual(['when-pending'])
    await nav
    await tick()
    expect(t.rec('async').status).toBe('skipped')
    expect(t.rec('join').status).toBe('done')
    expect(t.wizard.getState().status).toBe('done')
  })
})

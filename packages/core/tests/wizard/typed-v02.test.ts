/**
 * The typed façade, v0.2 surface (plan §9): `skip` / `invalidate` sugar, `progress` / `readyViews`,
 * `attach`, `correlationId` + `correlate`, `on` on non-wait kinds and flow-level `on` end to end.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { createSequentialIds } from '../../src/interpreter/env'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { createRun, type RunEvent } from '../../src/wizard/create-wizard'
import { defineWizard } from '../../src/wizard/define-wizard'

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const flow = defineWizard(
  {
    name: 'v02',
    context: z.object({
      id: z.string(),
      note: z.string().optional(),
      cancelled: z.boolean().optional(),
    }),
    events: {
      'note.added': z.object({ text: z.string(), orderId: z.string().optional() }),
      'order.cancelled': z.object({ orderId: z.string(), reason: z.string() }),
    },
    on: {
      'note.added': ({ payload, update }) => update({ note: `flow:${payload.text}` }),
      'order.cancelled': ({ payload, update }) => {
        update({ cancelled: true })
        return { cancel: payload.reason }
      },
    },
    correlate: {
      'note.added': (p) => p.orderId,
      'order.cancelled': (p) => p.orderId,
    },
  },
  ({ steps, view, step }) =>
    steps(
      {
        a: view({ input: z.object({ v: z.string() }), next: 'b' }),
        b: view({ next: 'c' }),
        c: view({ when: ({ context }) => context.note !== 'skip-c', next: 'end' }),
        end: step({ run: ({ context }) => `note=${context.note ?? ''}` }),
      },
      { start: 'a' },
    ),
)
function make(extra: { correlationId?: string } = {}) {
  const sched = createTestScheduler({ now: 1000 })
  const run = createRun(flow, {
    context: { id: 'w' },
    scheduler: sched,
    ids: createSequentialIds(),
    instanceId: 'wiz-1',
    ...extra,
  })
  const events: RunEvent<typeof flow>[] = []
  run.observe((e) => events.push(e))
  const of = <T extends RunEvent<typeof flow>['type']>(type: T) =>
    events.filter(
      (
        e,
      ): e is Extract<
        RunEvent<typeof flow>,
        {
          type: T
        }
      > => e.type === type,
    )
  return { run, sched, events, of }
}
describe('Run: progress / readyViews / skip / invalidate', () => {
  it('progress counts runnable sinks and skipped work; readyViews lists the current + ready views', async () => {
    const { run, of } = make()
    expect(run.progress()).toEqual({ done: 0, total: 4, ratio: 0 })
    expect(run.readyViews()).toEqual([])
    await run.start()
    expect(run.readyViews()).toEqual(['a'])
    expect(await run.skip('a', 'prefilled')).toMatchObject({ ok: true })
    expect(of('step.skipped').at(-1)).toMatchObject({ step: 'a', reason: 'command' })
    expect(run.getState().steps.a.status).toBe('skipped')
    expect(run.getState().current).toBe('b')
    expect(run.progress()).toEqual({ done: 1, total: 4, ratio: 1 / 4 })
    expect(run.readyViews()).toEqual(['b'])
    // `skip('typo')` from JS is a value, never a throw.
    expect(await run.skip('typo' as never)).toMatchObject({ ok: false })
    // invalidate a skipped step: back to idle (never automatic).
    expect(await run.invalidate('a')).toMatchObject({ ok: true })
    expect(of('step.invalidated').at(-1)).toMatchObject({ step: 'a', cascade: true })
    expect(run.getState().steps.a.status).toBe('idle')
    expect(run.progress()).toEqual({ done: 0, total: 4, ratio: 0 })
    // The current view cannot be invalidated (use `back`); an unknown id is a value.
    expect(await run.invalidate('b')).toMatchObject({ ok: false })
    expect(await run.invalidate('typo' as never, { cascade: false })).toMatchObject({
      ok: false,
    })
    run.dispose()
  })
  it('`when: false` skips a step when it becomes ready (`reason: when`) and the cursor moves past it', async () => {
    const direct = createRun(flow, { context: { id: 'w', note: 'skip-c' } })
    const events: RunEvent<typeof flow>[] = []
    direct.observe((e) => events.push(e))
    await direct.start()
    await direct.setInput('a', { v: 'x' })
    await direct.next() // a → b
    await direct.next() // b → c: `when` skips c, then the sink computes the output.
    await direct.whenIdle()
    expect(events.filter((e) => e.type === 'step.skipped').at(-1)).toMatchObject({
      step: 'c',
      reason: 'when',
    })
    expect(direct.getState().status).toBe('done')
    expect(direct.getState().output).toBe('note=skip-c')
    expect(direct.progress()).toEqual({ done: 4, total: 4, ratio: 1 })
    direct.dispose()
  })
})
describe('Run: attach, correlation, flow-level `on`', () => {
  it('attach hands the typed send to a source and detaches on dispose (or by hand)', async () => {
    const { run, of } = make()
    await run.start()
    let detached = 0
    const detach = run.attach((send) => {
      void send('note.added', { text: 'from-source' })
      return () => {
        detached += 1
      }
    })
    await tick()
    // A view (`a`) has no `note.added` handler; the flow-level one still ran (`flow:` prefix).
    expect(of('event.received').at(-1)).toMatchObject({ event: 'note.added' })
    expect(run.getState().context.note).toBe('flow:from-source')
    detach()
    detach() // idempotent
    expect(detached).toBe(1)
    run.attach(() => () => {
      detached += 1
    })
    run.dispose()
    expect(detached).toBe(2)
  })
  it('correlationId is stored in the state; a correlated event with another id is dropped, matching ids are delivered', async () => {
    const { run, of } = make({ correlationId: 'order-1' })
    expect(run.getState().correlationId).toBe('order-1')
    await run.start()
    const foreign = await run.send('note.added', { text: 'x', orderId: 'order-9' })
    expect(foreign).toMatchObject({ ok: false, reason: 'dropped' })
    expect(of('event.dropped').at(-1)).toMatchObject({ event: 'note.added', reason: 'correlation' })
    expect(run.getState().context.note).toBeUndefined()
    // Same id (or none): handled by the flow-level handler.
    await run.send('note.added', { text: 'mine', orderId: 'order-1' })
    expect(run.getState().context.note).toBe('flow:mine')
    await run.send('note.added', { text: 'anon' })
    expect(run.getState().context.note).toBe('flow:anon')
    // A flow-level `{ cancel }` cancels the flow.
    expect(
      await run.send('order.cancelled', { orderId: 'order-1', reason: 'changed mind' }),
    ).toMatchObject({
      ok: true,
    })
    expect(run.getState().status).toBe('cancelled')
    expect(run.getState().context.cancelled).toBe(true)
    run.dispose()
  })
  it('a task / view `on` handler runs while the step is active; a view handler may move the cursor', async () => {
    let release: (() => void) | undefined
    const f = defineWizard(
      {
        name: 'on-kinds',
        context: z.object({ hits: z.array(z.string()).default([]) }),
        events: { ping: z.object({ to: z.string().optional() }) },
      },
      ({ steps, view, step }) =>
        steps(
          {
            form: view({
              on: {
                ping: ({ payload, update, context }) => {
                  update({ hits: [...context.hits, 'form'] })
                  return payload.to === 'other' ? { next: 'other' } : undefined
                },
              },
              next: 'work',
            }),
            other: view({ next: 'work' }),
            work: step({
              run: () =>
                new Promise<number>((resolve) => {
                  release = () => resolve(1)
                }),
              on: { ping: ({ update, context }) => update({ hits: [...context.hits, 'work'] }) },
              next: 'end',
            }),
            end: step({}),
          },
          { start: 'form' },
        ),
    )
    const run = createRun(f, { context: {} })
    await run.start()
    expect(await run.send('ping', {})).toMatchObject({ ok: true, delivered: ['form'] })
    expect(run.getState().context.hits).toEqual(['form'])
    // `{ next: 'other' }` from a view handler moves the cursor (cause: 'event').
    expect(await run.send('ping', { to: 'other' })).toMatchObject({ ok: true })
    await tick()
    expect(run.getState().current).toBe('other')
    await run.next() // other → work (task runs, pending)
    expect(run.getState().steps.work.status).toBe('active')
    expect(await run.send('ping', {})).toMatchObject({ ok: true, delivered: ['work'] })
    await tick()
    expect(run.getState().context.hits).toEqual(['form', 'form', 'work'])
    release?.()
    await tick()
    expect(run.getState().status).toBe('done')
    run.dispose()
  })
  it('compiled handler results reach the machine raw: a wait `{ done }` overrides the output, `{ fail }` fails the wait, a stray task `{ next }` is ignored (reason: kind)', async () => {
    const f = defineWizard(
      {
        name: 'raw-results',
        context: boundary.trusted<{}>(),
        events: { paid: z.object({ amount: z.number() }), nudge: z.unknown() },
      },
      ({ steps, step }) =>
        steps(
          {
            hold: step({
              waitFor: {
                paid: ({ payload }) =>
                  payload.amount < 0
                    ? { fail: 'negative amount' }
                    : { done: { event: 'paid', payload: { amount: payload.amount * 2 } } },
              },
              next: 'work',
            }),
            work: step({
              run: () => new Promise<never>(() => {}),
              // A JS-style handler returning what a task cannot honour.
              on: { nudge: (() => ({ next: 'end' })) as unknown as () => undefined },
              next: 'end',
            }),
            end: step({}),
          },
          { start: 'hold' },
        ),
    )
    const doneWizard = createRun(f, { context: {} })
    const events: RunEvent<typeof f>[] = []
    doneWizard.observe((e) => events.push(e))
    await doneWizard.start()
    expect(await doneWizard.send('paid', { amount: 21 })).toMatchObject({ ok: true })
    expect(doneWizard.getState().steps.hold).toMatchObject({
      status: 'done',
      output: { event: 'paid', payload: { amount: 42 } },
    })
    expect(await doneWizard.send('nudge', 1)).toMatchObject({ ok: true, delivered: ['work'] })
    expect(events.filter((e) => e.type === 'event.handlerResultIgnored')).toMatchObject([
      { step: 'work', event: 'nudge', reason: 'kind' },
    ])
    expect(doneWizard.getState().steps.work.status).toBe('active')
    doneWizard.dispose()
    const failed = createRun(f, { context: {} })
    await failed.start()
    expect(await failed.send('paid', { amount: -1 })).toMatchObject({ ok: true })
    expect(failed.getState().steps.hold.error).toMatchObject({
      kind: 'hook',
      message: 'negative amount',
    })
    expect(failed.getState().status).toBe('halted')
    failed.dispose()
  })
  it('readyViews() is memoized per state (one array identity per seq)', async () => {
    const { run } = make()
    await run.start()
    const first = run.readyViews()
    expect(first).toEqual(['a'])
    expect(run.readyViews()).toBe(first)
    await run.setInput('a', { v: 'x' })
    expect(run.readyViews()).not.toBe(first)
    expect(run.readyViews()).toBe(run.readyViews())
    run.dispose()
  })
})

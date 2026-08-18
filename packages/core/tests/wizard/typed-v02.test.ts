/**
 * The typed façade, v0.2 surface (plan §9): `skip` / `invalidate` sugar, `progress` / `readyViews`,
 * `attach`, `correlationId` + `correlate`, `on` on non-wait kinds and flow-level `on` end to end.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { defineFlow } from '../../src/authoring/define-flow'
import { createSequentialIds } from '../../src/interpreter/env'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { createWizard, type WizardEvent } from '../../src/wizard/create-wizard'

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const s = defineFlow({
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
})
const flow = s.steps(
  {
    a: s.view({ input: z.object({ v: z.string() }), next: 'b' }),
    b: s.view({ next: 'c' }),
    c: s.view({ when: ({ context }) => context.note !== 'skip-c', next: 'end' }),
    end: s.final({ output: ({ context }) => `note=${context.note ?? ''}` }),
  },
  { start: 'a' },
)

function make(extra: { correlationId?: string } = {}) {
  const sched = createTestScheduler({ now: 1_000 })
  const wizard = createWizard(flow, {
    context: { id: 'w' },
    scheduler: sched,
    ids: createSequentialIds(),
    instanceId: 'wiz-1',
    ...extra,
  })
  const events: WizardEvent<typeof flow>[] = []
  wizard.observe((e) => events.push(e))
  const of = <T extends WizardEvent['type']>(type: T) =>
    events.filter((e): e is Extract<WizardEvent<typeof flow>, { type: T }> => e.type === type)
  return { wizard, sched, events, of }
}

describe('Wizard v0.2: progress / readyViews / skip / invalidate', () => {
  it('progress counts non-final steps (skipped = done); readyViews lists the current + ready views', async () => {
    const { wizard, of } = make()
    expect(wizard.progress()).toEqual({ done: 0, total: 3, ratio: 0 })
    expect(wizard.readyViews()).toEqual([])
    await wizard.start()
    expect(wizard.readyViews()).toEqual(['a'])
    expect(await wizard.skip('a', 'prefilled')).toMatchObject({ ok: true })
    expect(of('step.skipped').at(-1)).toMatchObject({ step: 'a', reason: 'command' })
    expect(wizard.getState().steps.a.status).toBe('skipped')
    expect(wizard.getState().current).toBe('b')
    expect(wizard.progress()).toEqual({ done: 1, total: 3, ratio: 1 / 3 })
    expect(wizard.readyViews()).toEqual(['b'])
    // `skip('typo')` from JS is a value, never a throw.
    expect(await wizard.skip('typo' as never)).toMatchObject({ ok: false })
    // invalidate a skipped step: back to idle (never automatic).
    expect(await wizard.invalidate('a')).toMatchObject({ ok: true })
    expect(of('step.invalidated').at(-1)).toMatchObject({ step: 'a', cascade: true })
    expect(wizard.getState().steps.a.status).toBe('idle')
    expect(wizard.progress()).toEqual({ done: 0, total: 3, ratio: 0 })
    // The current view cannot be invalidated (use `back`); an unknown id is a value.
    expect(await wizard.invalidate('b')).toMatchObject({ ok: false })
    expect(await wizard.invalidate('typo' as never, { cascade: false })).toMatchObject({
      ok: false,
    })
    wizard.dispose()
  })

  it('`when: false` skips a step when it becomes ready (`reason: when`) and the cursor moves past it', async () => {
    const direct = createWizard(flow, { context: { id: 'w', note: 'skip-c' } })
    const events: WizardEvent<typeof flow>[] = []
    direct.observe((e) => events.push(e))
    await direct.start()
    await direct.setInput('a', { v: 'x' })
    await direct.next() // a → b
    await direct.next() // b → c: `when` says false → c skipped → end (final) → done
    expect(events.filter((e) => e.type === 'step.skipped').at(-1)).toMatchObject({
      step: 'c',
      reason: 'when',
    })
    expect(direct.getState().status).toBe('done')
    expect(direct.getState().output).toBe('note=skip-c')
    expect(direct.progress()).toEqual({ done: 3, total: 3, ratio: 1 })
    direct.dispose()
  })
})

describe('Wizard v0.2: attach, correlation, flow-level `on`', () => {
  it('attach hands the typed send to a source and detaches on dispose (or by hand)', async () => {
    const { wizard, of } = make()
    await wizard.start()
    let detached = 0
    const detach = wizard.attach((send) => {
      void send('note.added', { text: 'from-source' })
      return () => {
        detached += 1
      }
    })
    await tick()
    // A view (`a`) has no `note.added` handler; the flow-level one still ran (`flow:` prefix).
    expect(of('event.received').at(-1)).toMatchObject({ event: 'note.added' })
    expect(wizard.getState().context.note).toBe('flow:from-source')
    detach()
    detach() // idempotent
    expect(detached).toBe(1)
    wizard.attach(() => () => {
      detached += 1
    })
    wizard.dispose()
    expect(detached).toBe(2)
    expect(() => wizard.attach(() => () => {})).toThrow(/disposed/)
  })

  it('correlationId is stored in the state; a correlated event with another id is dropped, matching ids are delivered', async () => {
    const { wizard, of } = make({ correlationId: 'order-1' })
    expect(wizard.getState().correlationId).toBe('order-1')
    await wizard.start()
    const foreign = await wizard.send('note.added', { text: 'x', orderId: 'order-9' })
    expect(foreign).toMatchObject({ ok: false, reason: 'dropped' })
    expect(of('event.dropped').at(-1)).toMatchObject({ event: 'note.added', reason: 'correlation' })
    expect(wizard.getState().context.note).toBeUndefined()
    // Same id (or none): handled by the flow-level handler.
    await wizard.send('note.added', { text: 'mine', orderId: 'order-1' })
    expect(wizard.getState().context.note).toBe('flow:mine')
    await wizard.send('note.added', { text: 'anon' })
    expect(wizard.getState().context.note).toBe('flow:anon')
    // A flow-level `{ cancel }` cancels the flow.
    expect(
      await wizard.send('order.cancelled', { orderId: 'order-1', reason: 'changed mind' }),
    ).toMatchObject({
      ok: true,
    })
    expect(wizard.getState().status).toBe('cancelled')
    expect(wizard.getState().context.cancelled).toBe(true)
    wizard.dispose()
  })

  it('a task / view `on` handler runs while the step is active; a view handler may move the cursor', async () => {
    const t = defineFlow({
      name: 'on-kinds',
      context: z.object({ hits: z.array(z.string()).default([]) }),
      events: { ping: z.object({ to: z.string().optional() }) },
    })
    let release: (() => void) | undefined
    const f = t.steps(
      {
        form: t.view({
          on: {
            ping: ({ payload, update, context }) => {
              update({ hits: [...context.hits, 'form'] })
              return payload.to === 'other' ? { next: 'other' } : undefined
            },
          },
          next: 'work',
        }),
        other: t.view({ next: 'work' }),
        work: t.task(
          () =>
            new Promise<number>((resolve) => {
              release = () => resolve(1)
            }),
          {
            on: { ping: ({ update, context }) => update({ hits: [...context.hits, 'work'] }) },
            next: 'end',
          },
        ),
        end: t.final(),
      },
      { start: 'form' },
    )
    const wizard = createWizard(f, { context: {} })
    await wizard.start()
    expect(await wizard.send('ping', {})).toMatchObject({ ok: true, delivered: ['form'] })
    expect(wizard.getState().context.hits).toEqual(['form'])
    // `{ next: 'other' }` from a view handler moves the cursor (cause: 'event').
    expect(await wizard.send('ping', { to: 'other' })).toMatchObject({ ok: true })
    await tick()
    expect(wizard.getState().current).toBe('other')
    await wizard.next() // other → work (task runs, pending)
    expect(wizard.getState().steps.work.status).toBe('active')
    expect(await wizard.send('ping', {})).toMatchObject({ ok: true, delivered: ['work'] })
    await tick()
    expect(wizard.getState().context.hits).toEqual(['form', 'form', 'work'])
    release?.()
    await tick()
    expect(wizard.getState().status).toBe('done')
    wizard.dispose()
  })

  it('compiled handler results reach the machine raw: a wait `{ done }` overrides the output, `{ fail }` fails the wait, a stray task `{ next }` is ignored (reason: kind)', async () => {
    const t = defineFlow({
      name: 'raw-results',
      context: boundary.trusted<{}>(),
      events: { paid: z.object({ amount: z.number() }), nudge: z.unknown() },
    })
    const f = t.steps(
      {
        hold: t.wait({
          on: {
            paid: ({ payload }) =>
              payload.amount < 0
                ? { fail: 'negative amount' }
                : { done: { event: 'paid', payload: { amount: payload.amount * 2 } } },
          },
          next: 'work',
        }),
        work: t.task(() => new Promise<never>(() => {}), {
          // A JS-style handler returning what a task cannot honour.
          on: { nudge: (() => ({ next: 'end' })) as unknown as () => undefined },
          next: 'end',
        }),
        end: t.final(),
      },
      { start: 'hold' },
    )
    const doneWizard = createWizard(f, { context: {} })
    const events: WizardEvent[] = []
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
    const failed = createWizard(f, { context: {} })
    await failed.start()
    expect(await failed.send('paid', { amount: -1 })).toMatchObject({ ok: true })
    expect(failed.getState().steps.hold.error).toMatchObject({
      kind: 'hook',
      message: 'negative amount',
    })
    expect(failed.getState().status).toBe('failed')
    failed.dispose()
  })

  it('readyViews() is memoized per state (one array identity per seq)', async () => {
    const { wizard } = make()
    await wizard.start()
    const first = wizard.readyViews()
    expect(first).toEqual(['a'])
    expect(wizard.readyViews()).toBe(first)
    await wizard.setInput('a', { v: 'x' })
    expect(wizard.readyViews()).not.toBe(first)
    expect(wizard.readyViews()).toBe(wizard.readyViews())
    wizard.dispose()
  })
})

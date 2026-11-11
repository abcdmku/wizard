/**
 * Typed end-to-end smoke test: `defineWizard` → `create` → view → task → sink, through the
 * real machine + interpreter. Asserts typed `getState().current`, typed outputs, projections,
 * events, resume, and the door-level errors of the façade.
 */
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { WizardError } from '../../src/errors'
import { createSequentialIds } from '../../src/interpreter/env'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { createMemoryStore } from '../../src/persistence/memory-store'
import { defineProjection } from '../../src/projection/define-projection'
import { createRun, type RunEvent } from '../../src/wizard/create-wizard'
import { defineWizard } from '../../src/wizard/define-wizard'

interface Deps {
  inventory: {
    reserve(cartId: string): Promise<{
      reservationId: string
    }>
  }
}
const checkoutFlow = defineWizard(
  {
    name: 'checkout',
    context: z.object({
      cartId: z.string(),
      total: z.number(),
      express: z.boolean().default(false),
      address: z.string().optional(),
    }),
    events: { 'payment.captured': z.object({ paymentId: z.string() }) },
    deps: boundary.trusted<Deps>(),
  },
  ({ steps, view, step }) => {
    const reserve = step({
      run: ({ context, deps }) => deps.inventory.reserve(context.cartId),
    })
    return steps(
      {
        shipping: view({
          input: z.object({ address: z.string().min(1), express: z.boolean().default(false) }),
          exit: ({ output, update }) =>
            update({ address: output.address, express: output.express }),
          next: 'reserve',
        }),
        reserve,
        receipt: step({
          needs: { reservation: reserve },
          run: ({ context, needs }) => ({
            cartId: context.cartId,
            express: context.express,
            reservationId: needs.reservation.reservationId,
          }),
        }),
      },
      { start: 'shipping' },
    )
  },
)
const deps: Deps = {
  inventory: { reserve: async (cartId) => ({ reservationId: `res-${cartId}` }) },
}
function make(extra: Partial<Parameters<typeof createRun<typeof checkoutFlow>>[1]> = {}) {
  const sched = createTestScheduler({ now: 1000 })
  return checkoutFlow.create(
    { cartId: 'c1', total: 10 },
    {
      deps,
      scheduler: sched,
      ids: createSequentialIds(),
      instanceId: 'wiz-1',
      ...extra,
    },
  )
}
describe('createRun: typed end-to-end', () => {
  it('view → task → final with typed state, outputs and events', async () => {
    const run = make()
    const events: RunEvent<typeof checkoutFlow>[] = []
    run.observe((e) => events.push(e))
    expect(run.id).toBe('wiz-1')
    expect(run.epoch).toBe(0)
    expect(run.flow).toBe(checkoutFlow)
    expect(run.getState().context).toEqual({ cartId: 'c1', total: 10, express: false }) // parsed (default applied)
    expect(run.getState().status).toBe('idle')
    expect(await run.start()).toMatchObject({ ok: true })
    expect(run.getState().current).toBe('shipping')
    expect(run.getSnapshot().state.current).toBe('shipping')
    // draft is rejected by the input boundary → INVALID_INPUT with issues, cursor stays
    const rejected = await run.next()
    expect(rejected).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(run.getState().steps.shipping.issues?.length).toBeGreaterThan(0)
    expect(await run.setInput('shipping', { address: 'Main St' })).toMatchObject({ ok: true })
    expect(await run.validate('shipping')).toEqual([])
    const nav = await run.next()
    expect(nav).toMatchObject({ ok: true, from: 'shipping', to: 'reserve' })
    // the task ran (async run resolves through the queue), auto-advanced to the final
    await new Promise((r) => setTimeout(r, 0))
    const state = run.getState()
    expect(state.status).toBe('done')
    expect(state.steps.shipping.output).toEqual({ address: 'Main St', express: false })
    expect(state.steps.reserve.output).toEqual({ reservationId: 'res-c1' })
    expect(state.output).toEqual({ cartId: 'c1', express: false, reservationId: 'res-c1' })
    expect(state.context.address).toBe('Main St')
    expect(events.some((e) => e.type === 'step.done' && e.step === 'reserve')).toBe(true)
    expect(events.some((e) => e.type === 'flow.done')).toBe(true)
    expect(run.log().length).toBeGreaterThan(0)
    run.dispose()
  })
  it('project() applies a deny-by-default projection; the wrong flow is rejected', async () => {
    const run = make()
    await run.start()
    await run.setInput('shipping', { address: 'x' })
    const projection = defineProjection(checkoutFlow, {
      expose: { steps: { shipping: { input: true } }, context: ['total'] },
    })
    const projected = run.project(projection)
    expect(projected.context).toEqual({ total: 10 })
    expect(projected.current).toBe('shipping')
    expect(projected.steps.shipping.input).toEqual({ address: 'x' })
    expect(projected.steps.shipping.phase).toBe('waiting')
    expect('output' in projected.steps.reserve).toBe(false)
    const otherFlow = defineWizard(
      { name: 'other', context: boundary.trusted() },
      ({ steps, step }) => steps({ e: step({}) }),
    )
    const otherProjection = defineProjection(otherFlow, { expose: {} })
    expect(() => run.project(otherProjection as any)).toThrowError(/defined for flow 'other'/)
    run.dispose()
  })
  it('send() routes declared events; an undeclared event is a programmer error', async () => {
    const run = make()
    await run.start()
    const result = await run.send('payment.captured', { paymentId: 'p' })
    expect(result).toMatchObject({ ok: true, buffered: true }) // no wait step listens → buffered
    const bad = await run.send('payment.captured', { nope: 1 } as unknown)
    expect(bad).toMatchObject({ ok: false, reason: 'rejected' })
    await expect(run.send('unknown' as any, {})).rejects.toThrow(WizardError)
    run.dispose()
  })
  it('dispatch() is the wire door: bad shapes and unknown steps are results, not throws', async () => {
    const run = make()
    await run.start()
    // `Command<F>` rejects unknown ids at compile time; a JS caller still gets a result, not a throw.
    expect(await run.dispatch({ type: 'go', step: 'nope' } as never)).toMatchObject({
      ok: false,
      code: 'NOT_A_VIEW',
    })
    expect(await run.dispatch({ type: 'wat' } as any)).toMatchObject({
      ok: false,
      code: 'INVALID_COMMAND',
    })
    run.dispose()
  })
  it('startStep(task) starts one ready task under autoRun: manual; reset() returns to the initial state', async () => {
    const manualFlow = defineWizard(
      {
        name: 'manual',
        context: z.object({ n: z.number() }),
        autoRun: 'manual',
      },
      ({ steps, step }) => {
        const a = step({ run: ({ context }) => context.n + 1 })
        const b = step({ needs: { a }, run: ({ needs }) => needs.a * 2 })
        const end = step({ needs: { b }, run: ({ needs }) => needs.b })
        return steps({ a, b, end }, { start: 'a' })
      },
    )
    const run = createRun(manualFlow, { context: { n: 1 }, instanceId: 'wiz-m' })
    await run.start()
    expect(run.getState().status).toBe('waiting') // ready, but not started: manual
    expect(run.getState().steps.a.status).toBe('idle')
    expect(run.explain('a').reasons).toContain('auto-run-manual')
    expect(await run.startStep('a')).toMatchObject({ ok: true })
    await new Promise((r) => setTimeout(r, 0))
    expect(run.getState().steps.a.output).toBe(2)
    expect(await run.startStep('b')).toMatchObject({ ok: true })
    await new Promise((r) => setTimeout(r, 0))
    expect(run.getState().steps.b.output).toBe(4)
    // The runnable sink waits for startReady() under manual auto-run.
    expect(run.getState().status).toBe('waiting')
    expect(await run.startReady()).toMatchObject({ ok: true })
    await run.whenIdle()
    expect(run.getState().status).toBe('done')
    expect(run.getState().output).toBe(4)
    // Not a task / not active → results, not throws.
    expect(await run.dispatch({ type: 'startStep', step: 'end' } as never)).toMatchObject({
      ok: false,
    })
    expect(await run.reset()).toMatchObject({ ok: true })
    expect(run.getState()).toMatchObject({ status: 'idle', current: null, active: [] })
    expect(run.getState().steps.a.status).toBe('idle')
    expect(run.log().some((e) => e.type === 'flow.reset')).toBe(true)
    expect(await run.start()).toMatchObject({ ok: true }) // runs again after a reset
    run.dispose()
  })
  it('save/resume round trip through a memory store keeps typed state and bumps epoch', async () => {
    const store = createMemoryStore()
    const run = make({ store, key: 'k1' })
    await run.start()
    await run.setInput('shipping', { address: 'Main St' })
    await run.save()
    run.dispose()
    const saved = await store.get('k1')
    const resumed = checkoutFlow.resume(saved, {
      deps,
      scheduler: createTestScheduler({ now: 2000 }),
      ids: createSequentialIds(),
    })
    expect(resumed.epoch).toBe(1)
    expect(resumed.getState().current).toBe('shipping')
    expect(resumed.getState().steps.shipping.input).toEqual({ address: 'Main St' })
    expect(resumed.getState().context.cartId).toBe('c1')
    resumed.dispose()
    expect(() => checkoutFlow.resume({ v: 1 }, { deps })).toThrow(WizardError)
  })
})
describe('createRun: doors', () => {
  it('rejects a context that fails its boundary (BOUNDARY_REJECTED with issues)', () => {
    try {
      createRun(checkoutFlow, { context: { cartId: 1 } as any, deps })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(WizardError)
      expect((error as WizardError).code).toBe('BOUNDARY_REJECTED')
      expect((error as WizardError).issues?.length).toBeGreaterThan(0)
    }
  })
  it('an async context boundary (async Standard Schema) needs createAsync', async () => {
    const asyncSchema: StandardSchemaV1<
      {
        n: number
      },
      {
        n: number
        parsed: true
      }
    > = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: async (value) =>
          typeof value === 'object' && value !== null && 'n' in value && typeof value.n === 'number'
            ? { value: { n: value.n, parsed: true } }
            : { issues: [{ message: 'expected { n: number }' }] },
      },
    }
    const flow = defineWizard({ name: 'async', context: asyncSchema }, ({ steps, step }) =>
      steps({ end: step({ run: ({ context }) => context }) }),
    )
    expect(() => flow.create({ n: 1 })).toThrowError(/use createAsync\(\)\/resumeAsync\(\)/)
    const run = await flow.createAsync({ n: 1 })
    expect(run.getState().context).toEqual({ n: 1, parsed: true })
    run.dispose()
    await expect(flow.createAsync({ n: 'x' } as never)).rejects.toMatchObject({
      code: 'BOUNDARY_REJECTED',
    })
  })
  it('parses deps through the deps boundary and hands them to hooks', async () => {
    let seen: unknown
    const flow = defineWizard(
      {
        name: 'deps',
        context: boundary.trusted<{}>(),
        deps: boundary.parse(
          (v) =>
            ({ ...(v as object), parsed: true }) as {
              parsed: boolean
            },
        ),
      },
      ({ steps, step }) =>
        steps({
          t: step({
            run: ({ deps }) => {
              seen = deps
              return 1
            },
            next: 'e',
          }),
          e: step({}),
        }),
    )
    const run = createRun(flow, { context: {}, deps: { parsed: false } })
    await run.start()
    await new Promise((r) => setTimeout(r, 0))
    expect(seen).toEqual({ parsed: true })
    run.dispose()
  })
  it('child() returns a typed run for an active flow step, memoised per runtime', async () => {
    const childFlow = defineWizard(
      { name: 'child', context: z.object({ n: z.number() }) },
      ({ steps, view, step }) =>
        steps({
          hold: view({ next: 'end' }),
          end: step({ run: ({ context }) => context.n }),
        }),
    )
    const parentFlow = defineWizard(
      {
        name: 'parent',
        context: boundary.trusted<{
          n: number
        }>(),
      },
      ({ steps, flow, step }) =>
        steps({
          sub: flow(childFlow, {
            context: ({ context }) => ({ n: context.n + 1 }),
            next: 'end',
          }),
          end: step({}),
        }),
    )
    const run = createRun(parentFlow, { context: { n: 1 } })
    await run.start()
    await new Promise((r) => setTimeout(r, 0))
    const sub = run.child('sub')
    expect(sub).toBe(run.child('sub'))
    expect(sub.flow).toBe(childFlow)
    expect(sub.getState().context).toEqual({ n: 2 }) // mapped and parsed by the child's boundary
    expect(sub.getState().current).toBe('hold')
    expect(run.getSnapshot().children.sub?.state.current).toBe('hold')
    run.dispose()
  })
})

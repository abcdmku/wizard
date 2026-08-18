/**
 * Typed end-to-end smoke test: `defineFlow` → `createWizard` → view → task → final, through the
 * real machine + interpreter. Asserts typed `getState().current`, typed outputs, projections,
 * events, resume, and the door-level errors of the façade.
 */
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { defineFlow } from '../../src/authoring/define-flow'
import { WizardError } from '../../src/errors'
import { createSequentialIds } from '../../src/interpreter/env'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { createMemoryStore } from '../../src/persistence/memory-store'
import { defineProjection } from '../../src/projection/define-projection'
import {
  createWizard,
  createWizardAsync,
  resumeWizard,
  type WizardEvent,
} from '../../src/wizard/create-wizard'

interface Deps {
  inventory: { reserve(cartId: string): Promise<{ reservationId: string }> }
}

const s = defineFlow({
  name: 'checkout',
  context: z.object({
    cartId: z.string(),
    total: z.number(),
    express: z.boolean().default(false),
    address: z.string().optional(),
  }),
  events: { 'payment.captured': z.object({ paymentId: z.string() }) },
  deps: boundary.trusted<Deps>(),
})
const checkout = s.steps(
  {
    shipping: s.view({
      input: z.object({ address: z.string().min(1), express: z.boolean().default(false) }),
      exit: ({ output, update }) => update({ address: output.address, express: output.express }),
      next: 'reserve',
    }),
    reserve: s.task(({ context, deps }) => deps.inventory.reserve(context.cartId), {
      next: 'receipt',
    }),
    receipt: s.final({
      output: ({ context, steps }) => ({
        cartId: context.cartId,
        express: context.express,
        reserved: steps.reserve?.status,
      }),
    }),
  },
  { start: 'shipping' },
)
const deps: Deps = {
  inventory: { reserve: async (cartId) => ({ reservationId: `res-${cartId}` }) },
}

function make(extra: Partial<Parameters<typeof createWizard<typeof checkout>>[1]> = {}) {
  const sched = createTestScheduler({ now: 1_000 })
  return createWizard(checkout, {
    context: { cartId: 'c1', total: 10 },
    deps,
    scheduler: sched,
    ids: createSequentialIds(),
    instanceId: 'wiz-1',
    ...extra,
  })
}

describe('createWizard: typed end-to-end', () => {
  it('view → task → final with typed state, outputs and events', async () => {
    const wizard = make()
    const events: WizardEvent<typeof checkout>[] = []
    wizard.observe((e) => events.push(e))
    expect(wizard.id).toBe('wiz-1')
    expect(wizard.epoch).toBe(0)
    expect(wizard.flow).toBe(checkout)
    expect(wizard.getState().context).toEqual({ cartId: 'c1', total: 10, express: false }) // parsed (default applied)
    expect(wizard.getState().status).toBe('idle')

    expect(await wizard.start()).toMatchObject({ ok: true })
    expect(wizard.getState().current).toBe('shipping')
    expect(wizard.getSnapshot().state.current).toBe('shipping')

    // draft is rejected by the input boundary → INVALID_INPUT with issues, cursor stays
    const rejected = await wizard.next()
    expect(rejected).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(wizard.getState().steps.shipping.issues?.length).toBeGreaterThan(0)

    expect(await wizard.setInput('shipping', { address: 'Main St' })).toMatchObject({ ok: true })
    expect(await wizard.validate('shipping')).toEqual([])
    const nav = await wizard.next()
    expect(nav).toMatchObject({ ok: true, from: 'shipping', to: 'reserve' })
    // the task ran (async run resolves through the queue), auto-advanced to the final
    await new Promise((r) => setTimeout(r, 0))
    const state = wizard.getState()
    expect(state.status).toBe('done')
    expect(state.steps.shipping.output).toEqual({ address: 'Main St', express: false })
    expect(state.steps.reserve.output).toEqual({ reservationId: 'res-c1' })
    expect(state.output).toEqual({ cartId: 'c1', express: false, reserved: 'done' })
    expect(state.context.address).toBe('Main St')
    expect(events.some((e) => e.type === 'step.done' && e.step === 'reserve')).toBe(true)
    expect(events.some((e) => e.type === 'flow.done')).toBe(true)
    expect(wizard.log().length).toBeGreaterThan(0)
    wizard.dispose()
  })

  it('project() applies a deny-by-default projection; the wrong flow is rejected', async () => {
    const wizard = make()
    await wizard.start()
    await wizard.setInput('shipping', { address: 'x' })
    const projection = defineProjection(checkout, {
      expose: { steps: { shipping: { input: true } }, context: ['total'] },
    })
    const projected = wizard.project(projection)
    expect(projected.context).toEqual({ total: 10 })
    expect(projected.current).toBe('shipping')
    expect(projected.steps.shipping.input).toEqual({ address: 'x' })
    expect(projected.steps.shipping.phase).toBe('waiting')
    expect('output' in projected.steps.reserve).toBe(false)
    const o = defineFlow({ name: 'other', context: boundary.trusted() })
    const other = o.steps({ e: o.final() })
    const otherProjection = defineProjection(other, { expose: {} })
    expect(() => wizard.project(otherProjection as any)).toThrowError(/defined for flow 'other'/)
    wizard.dispose()
  })

  it('send() routes declared events; an undeclared event is a programmer error', async () => {
    const wizard = make()
    await wizard.start()
    const result = await wizard.send('payment.captured', { paymentId: 'p' })
    expect(result).toMatchObject({ ok: true, buffered: true }) // no wait step listens → buffered
    const bad = await wizard.send('payment.captured', { nope: 1 })
    expect(bad).toMatchObject({ ok: false, reason: 'rejected' })
    await expect(wizard.send('unknown' as any, {})).rejects.toThrow(WizardError)
    wizard.dispose()
  })

  it('dispatch() is the wire door: bad shapes and unknown steps are results, not throws', async () => {
    const wizard = make()
    await wizard.start()
    // `Command<F>` rejects unknown ids at compile time; a JS caller still gets a result, not a throw.
    expect(await wizard.dispatch({ type: 'go', step: 'nope' } as never)).toMatchObject({
      ok: false,
      code: 'NOT_A_VIEW',
    })
    expect(await wizard.dispatch({ type: 'wat' } as any)).toMatchObject({
      ok: false,
      code: 'INVALID_COMMAND',
    })
    wizard.dispose()
  })

  it('run(task) starts one ready task under autoRun: manual; reset() returns to the initial state', async () => {
    const m = defineFlow({
      name: 'manual',
      context: z.object({ n: z.number() }),
      autoRun: 'manual',
    })
    const manual = m.steps(
      {
        a: m.task(({ context }) => context.n + 1, { next: 'b' }),
        b: m.task(({ steps }) => (steps.a?.output as number) * 2, { next: 'end' }),
        end: m.final({ output: ({ steps }) => steps.b?.output }),
      },
      { start: 'a' },
    )
    const wizard = createWizard(manual, { context: { n: 1 }, instanceId: 'wiz-m' })
    await wizard.start()
    expect(wizard.getState().status).toBe('waiting') // ready, but not started: manual
    expect(wizard.getState().steps.a.status).toBe('idle')
    expect(wizard.explain('a').reasons).toContain('auto-run-manual')
    expect(await wizard.run('a')).toMatchObject({ ok: true })
    await new Promise((r) => setTimeout(r, 0))
    expect(wizard.getState().steps.a.output).toBe(2)
    expect(await wizard.run('b')).toMatchObject({ ok: true })
    await new Promise((r) => setTimeout(r, 0))
    expect(wizard.getState().steps.b.output).toBe(4)
    // The final step is a non-view step too: under `manual` it waits for runReady().
    expect(wizard.getState().status).toBe('waiting')
    expect(await wizard.runReady()).toMatchObject({ ok: true })
    expect(wizard.getState().status).toBe('done')
    expect(wizard.getState().output).toBe(4)
    // Not a task / not active → results, not throws.
    expect(await wizard.dispatch({ type: 'run', step: 'end' } as never)).toMatchObject({
      ok: false,
    })
    expect(await wizard.reset()).toMatchObject({ ok: true })
    expect(wizard.getState()).toMatchObject({ status: 'idle', current: null, active: [] })
    expect(wizard.getState().steps.a.status).toBe('idle')
    expect(wizard.log().some((e) => e.type === 'flow.reset')).toBe(true)
    expect(await wizard.start()).toMatchObject({ ok: true }) // runs again after a reset
    wizard.dispose()
  })

  it('save/resume round trip through a memory store keeps typed state and bumps epoch', async () => {
    const store = createMemoryStore()
    const wizard = make({ store, key: 'k1' })
    await wizard.start()
    await wizard.setInput('shipping', { address: 'Main St' })
    await wizard.save()
    wizard.dispose()
    const saved = await store.get('k1')
    const resumed = resumeWizard(checkout, saved, {
      deps,
      scheduler: createTestScheduler({ now: 2_000 }),
      ids: createSequentialIds(),
    })
    expect(resumed.epoch).toBe(1)
    expect(resumed.getState().current).toBe('shipping')
    expect(resumed.getState().steps.shipping.input).toEqual({ address: 'Main St' })
    expect(resumed.getState().context.cartId).toBe('c1')
    resumed.dispose()
    expect(() => resumeWizard(checkout, { v: 1 }, { deps })).toThrow(WizardError)
  })
})

describe('createWizard: doors', () => {
  it('rejects a context that fails its boundary (BOUNDARY_REJECTED with issues)', () => {
    try {
      createWizard(checkout, { context: { cartId: 1 } as any, deps })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(WizardError)
      expect((error as WizardError).code).toBe('BOUNDARY_REJECTED')
      expect((error as WizardError).issues?.length).toBeGreaterThan(0)
    }
  })

  it('an async context boundary (async Standard Schema) needs createWizardAsync', async () => {
    const asyncSchema: StandardSchemaV1<{ n: number }, { n: number; parsed: true }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: async (value) =>
          typeof value === 'object' && value !== null && 'n' in value && typeof value.n === 'number'
            ? { value: { n: value.n, parsed: true } }
            : { issues: [{ message: 'expected { n: number }' }] },
      },
    }
    const a = defineFlow({ name: 'async', context: asyncSchema })
    const flow = a.steps({ end: a.final({ output: ({ context }) => context }) })
    expect(() => createWizard(flow, { context: { n: 1 } })).toThrowError(/use createWizardAsync/)
    const wizard = await createWizardAsync(flow, { context: { n: 1 } })
    expect(wizard.getState().context).toEqual({ n: 1, parsed: true })
    wizard.dispose()
    await expect(createWizardAsync(flow, { context: { n: 'x' } as never })).rejects.toMatchObject({
      code: 'BOUNDARY_REJECTED',
    })
  })

  it('parses deps through the deps boundary and hands them to hooks', async () => {
    let seen: unknown
    const d = defineFlow({
      name: 'deps',
      context: boundary.trusted<{}>(),
      deps: boundary.parse((v) => ({ ...(v as object), parsed: true }) as { parsed: boolean }),
    })
    const flow = d.steps({
      t: d.task(
        ({ deps }) => {
          seen = deps
          return 1
        },
        { next: 'e' },
      ),
      e: d.final(),
    })
    const wizard = createWizard(flow, { context: {}, deps: { parsed: false } })
    await wizard.start()
    await new Promise((r) => setTimeout(r, 0))
    expect(seen).toEqual({ parsed: true })
    wizard.dispose()
  })

  it('child() returns a typed wizard for an active flow step, memoised per runtime', async () => {
    const c = defineFlow({ name: 'child', context: z.object({ n: z.number() }) })
    const child = c.steps({
      hold: c.view({ next: 'end' }),
      end: c.final({ output: ({ context }) => context.n }),
    })
    const p = defineFlow({ name: 'parent', context: boundary.trusted<{ n: number }>() })
    const parent = p.steps({
      sub: p.flow(child, { context: ({ context }) => ({ n: context.n + 1 }), next: 'end' }),
      end: p.final(),
    })
    const wizard = createWizard(parent, { context: { n: 1 } })
    await wizard.start()
    await new Promise((r) => setTimeout(r, 0))
    const sub = wizard.child('sub')
    expect(sub).toBe(wizard.child('sub'))
    expect(sub.flow).toBe(child)
    expect(sub.getState().context).toEqual({ n: 2 }) // mapped and parsed by the child's boundary
    expect(sub.getState().current).toBe('hold')
    expect(wizard.getSnapshot().children.sub?.state.current).toBe('hold')
    wizard.dispose()
  })
})

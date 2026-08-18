import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { compile } from '../../src/authoring/compile'
import type { CompiledFlow } from '../../src/authoring/compiled'
import { defineFlow } from '../../src/authoring/define-flow'
import type { AnyFlow } from '../../src/authoring/types'
import { WizardError } from '../../src/errors'
import { initialState } from '../../src/machine'
import type { StepRecord, WizardState } from '../../src/machine/state'
import { applyProjection } from '../../src/projection/apply-projection'
import { defineProjection } from '../../src/projection/define-projection'
import { createWizard } from '../../src/wizard/create-wizard'
import type { Snapshot } from '../../src/wizard/snapshot'

const c = defineFlow({
  name: 'child',
  context: z.object({ n: z.number(), childSecret: z.string() }),
})
const child = c.steps({
  work: c.task(async () => ({ r: 1 }), { next: 'end' }),
  end: c.final({ output: () => 'child-out' }),
})

const s = defineFlow({
  name: 'root',
  context: z.object({ cartId: z.string(), total: z.number(), secret: z.string() }),
})
const flow = s.steps(
  {
    form: s.view({ input: z.object({ address: z.string() }), next: 'reserve' }),
    reserve: s.task(async () => ({ reservationId: 'r' }), { next: 'sub' }),
    sub: s.flow(child, { context: () => ({ n: 1, childSecret: 's' }), next: 'done' }),
    done: s.final({ output: () => ({ receipt: 1 }) }),
  },
  { start: 'form' },
)
const def = compile(flow)

function stateOf(
  d: CompiledFlow,
  context: unknown,
  patch: (state: WizardState) => Partial<WizardState>,
  instanceId = 'wiz-1',
): WizardState {
  const env = { def: d, path: [], now: () => 1_000, id: (p: string) => `${p}-1` }
  const base = initialState(env, { instanceId, context, now: 1_000 })
  return { ...base, ...patch(base) }
}
const rec = (state: WizardState, id: string, patch: Partial<StepRecord>): StepRecord => ({
  ...(state.steps[id] as StepRecord),
  ...patch,
})

describe('applyProjection', () => {
  const state = stateOf(def, { cartId: 'c1', total: 42, secret: 'hunter2' }, (base) => ({
    status: 'waiting',
    current: 'form',
    active: ['form'],
    seq: 7,
    epoch: 1,
    output: { receipt: 1 },
    steps: {
      ...base.steps,
      form: rec(base, 'form', {
        status: 'active',
        input: { address: 'street 1' },
        output: { address: 'street 1' },
        issues: [{ message: 'too short', path: ['address'] }],
        visitedCount: 1,
      }),
      reserve: rec(base, 'reserve', {
        status: 'failed',
        attempt: 2,
        output: { reservationId: 'r' },
        error: {
          name: 'Error',
          message: 'boom',
          code: 'E_BOOM',
          kind: 'run',
          at: 5,
          attempt: 2,
          issues: [{ message: 'x' }],
        },
      }),
      sub: rec(base, 'sub', {
        status: 'active',
        child: { status: 'running', current: null, progress: 0.5, seq: 3 },
      }),
    },
  }))

  it('is deny-by-default: base facts only — no context, flow output, input, output, issues, error or child', () => {
    const projection = defineProjection(flow, { expose: {} })
    const out = applyProjection(projection, state, def)
    expect(out).toEqual({
      instanceId: 'wiz-1',
      epoch: 1,
      seq: 7,
      status: 'waiting',
      current: 'form',
      context: {},
      steps: {
        form: { id: 'form', kind: 'view', status: 'active', phase: 'waiting', attempt: 0 },
        reserve: { id: 'reserve', kind: 'task', status: 'failed', attempt: 2 },
        sub: { id: 'sub', kind: 'flow', status: 'active', phase: 'running', attempt: 0 },
        done: { id: 'done', kind: 'final', status: 'idle', attempt: 0 },
      },
    })
    expect(JSON.parse(JSON.stringify(out))).toEqual(out)
    expect(JSON.stringify(out)).not.toContain('boom')
    expect(JSON.stringify(out)).not.toContain('too short')
  })

  it('exposes exactly the listed context keys, flow output, and per-step input/output/issues/error', () => {
    const projection = defineProjection(flow, {
      expose: {
        steps: { form: { input: true, issues: true }, reserve: { output: true, error: true } },
        context: ['total', 'cartId'],
        output: true,
      },
    })
    const out = applyProjection(projection, state, def)
    expect(out.context).toEqual({ total: 42, cartId: 'c1' })
    expect(out.output).toEqual({ receipt: 1 })
    expect(out.steps.form.input).toEqual({ address: 'street 1' })
    expect(out.steps.form.issues).toEqual([{ message: 'too short', path: ['address'] }])
    expect('output' in out.steps.form).toBe(false)
    expect('error' in out.steps.form).toBe(false)
    expect(out.steps.reserve.output).toEqual({ reservationId: 'r' })
    expect(out.steps.reserve.error).toEqual({ name: 'Error', message: 'boom', code: 'E_BOOM' })
    expect('input' in out.steps.reserve).toBe(false)
    expect('issues' in out.steps.reserve).toBe(false)
    expect('secret' in out.context).toBe(false)
  })

  it('sanitises exposed errors to { name, message, code? } (no kind/at/attempt/issues)', () => {
    const projection = defineProjection(flow, { expose: { steps: { reserve: { error: true } } } })
    const out = applyProjection(projection, state, def)
    expect(out.steps.reserve.error).toEqual({ name: 'Error', message: 'boom', code: 'E_BOOM' })
    const noCode = stateOf(def, {}, (base) => ({
      steps: {
        ...base.steps,
        reserve: rec(base, 'reserve', {
          status: 'failed',
          error: { name: 'E', message: 'm', kind: 'run', at: 1 },
        }),
      },
    }))
    expect(applyProjection(projection, noCode, def).steps.reserve.error).toEqual({
      name: 'E',
      message: 'm',
    })
  })

  it('child: true exposes the compact ChildSummary only', () => {
    const projection = defineProjection(flow, { expose: { steps: { sub: { child: true } } } })
    const out = applyProjection(projection, state, def)
    expect(out.steps.sub.child).toEqual({ status: 'running', current: null, progress: 0.5, seq: 3 })
    // A step without a summary yet has no `child` key.
    const fresh = stateOf(def, {}, () => ({}))
    expect('child' in applyProjection(projection, fresh, def).steps.sub).toBe(false)
  })

  it('projects an exposed child from its snapshot (recursively, deny-by-default inside)', () => {
    const childDef = def.steps.sub?.child as CompiledFlow
    const childState = stateOf(
      childDef,
      { n: 1, childSecret: 's' },
      (base) => ({
        status: 'running',
        active: ['work'],
        seq: 3,
        steps: {
          ...base.steps,
          work: rec(base, 'work', { status: 'active', attempt: 1, output: { r: 1 } }),
        },
      }),
      'child-1',
    )
    const childSnapshot: Snapshot = {
      v: 1,
      flow: { name: 'child', version: 1 },
      instanceId: 'child-1',
      epoch: 0,
      seq: 3,
      savedAt: 1_000,
      state: childState,
      children: {},
    }
    const parentState = stateOf(def, { cartId: 'c', total: 1, secret: 's' }, (base) => ({
      status: 'running',
      active: ['sub'],
      steps: {
        ...base.steps,
        sub: rec(base, 'sub', {
          status: 'active',
          child: { status: 'running', current: null, progress: 0, seq: 3 },
        }),
      },
    }))
    const projection = defineProjection(flow, {
      expose: { steps: { sub: { child: { steps: { work: { output: true } }, context: ['n'] } } } },
    })
    const out = applyProjection(projection, parentState, def, { sub: childSnapshot })
    expect(out.steps.sub.child).toEqual({
      instanceId: 'child-1',
      epoch: 0,
      seq: 3,
      status: 'running',
      current: null,
      context: { n: 1 },
      steps: {
        work: {
          id: 'work',
          kind: 'task',
          status: 'active',
          phase: 'running',
          attempt: 1,
          output: { r: 1 },
        },
        end: { id: 'end', kind: 'final', status: 'idle', attempt: 0 },
      },
    })
    // no snapshot yet → no child key; unexposed child → absent even with a snapshot
    expect('child' in applyProjection(projection, parentState, def).steps.sub).toBe(false)
    const bare = defineProjection(flow, { expose: { steps: { sub: { output: true } } } })
    expect(
      'child' in applyProjection(bare, parentState, def, { sub: childSnapshot }).steps.sub,
    ).toBe(false)
  })

  it('missing context keys are simply omitted; non-object context yields {}', () => {
    const projection = defineProjection(flow, { expose: { context: ['total'] } })
    const partial = stateOf(def, { cartId: 'c' }, () => ({}))
    expect(applyProjection(projection, partial, def).context).toEqual({})
    const weird = stateOf(def, 'not-an-object', () => ({}))
    expect(applyProjection(projection, weird, def).context).toEqual({})
  })

  it("reserved names: only OWN context keys are picked, and a step or key named '__proto__' stays an own property", () => {
    // Inherited `constructor` / `toString` are not context values even when listed.
    const projection = defineProjection(flow, {
      expose: { context: ['total', 'constructor', 'toString', '__proto__'] as never },
    })
    const state = stateOf(def, { total: 1 }, () => ({}))
    expect(applyProjection(projection, state, def).context).toEqual({ total: 1 })
    // An own `__proto__` context key (JSON.parse can produce one) is copied as an own key.
    const polluted = stateOf(def, JSON.parse('{"total":2,"__proto__":{"x":1}}'), () => ({}))
    const context = applyProjection(projection, polluted, def).context as Record<string, unknown>
    expect(Object.hasOwn(context, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(context)).toBe(Object.prototype)

    const r = defineFlow({ name: 'reserved', context: boundary.trusted<Record<string, never>>() })
    const reserved = r.steps(
      { ['__proto__']: r.view({ next: 'constructor' }), constructor: r.final() },
      { start: '__proto__' },
    )
    const rdef = compile(reserved)
    const rstate = stateOf(rdef, {}, () => ({}))
    const projected = applyProjection(defineProjection(reserved, { expose: {} }), rstate, rdef)
    expect(Object.hasOwn(projected.steps, '__proto__')).toBe(true)
    expect(Object.hasOwn(projected.steps, 'constructor')).toBe(true)
    expect(Object.getPrototypeOf(projected.steps)).toBe(Object.prototype)
    const roundTripped = JSON.parse(JSON.stringify(projected)) as { steps: object }
    expect(Object.getOwnPropertyDescriptor(roundTripped.steps, '__proto__')?.value).toMatchObject({
      id: '__proto__',
      kind: 'view',
    })
  })

  it('projects 8 real child levels precisely (the depth budget counts child edges)', async () => {
    // leaf: a view that stays active; each level embeds the previous one as step `c`.
    const leaf = defineFlow({ name: 'leaf', context: boundary.trusted<{ n: number }>() })
    let current: AnyFlow = leaf.steps({ v: leaf.view({ next: 'end' }), end: leaf.final() })
    let expose: Record<string, unknown> = { steps: { v: { input: true } }, context: ['n'] }
    for (let level = 1; level <= 8; level += 1) {
      const l = defineFlow({ name: `level${level}`, context: boundary.trusted<{ n: number }>() })
      current = l.steps({
        c: l.flow(current, { context: ({ context }) => ({ n: context.n + 1 }), next: 'end' }),
        end: l.final(),
      })
      expose = { steps: { c: { child: expose } }, context: ['n'] }
    }
    const root = current
    const wizard = createWizard(root, { context: { n: 0 } })
    await wizard.start()
    const projection = defineProjection(root, { expose: expose as never })
    let node = wizard.project(projection) as Record<string, unknown>
    for (let level = 8; level >= 1; level -= 1) {
      expect(node.context).toEqual({ n: 8 - level })
      const steps = node.steps as Record<string, Record<string, unknown>>
      expect(steps.c?.status).toBe('active')
      node = steps.c?.child as Record<string, unknown>
      expect(node).toBeDefined()
      expect('~depth' in node).toBe(false)
    }
    // The leaf (8 child edges below the root) is projected precisely, not the fallback.
    expect(node.context).toEqual({ n: 8 })
    expect((node.steps as Record<string, Record<string, unknown>>).v?.status).toBe('active')
    wizard.dispose()
  })
})

describe('defineProjection', () => {
  it('records the flow OBJECT and the spec; ~types is undefined', () => {
    const projection = defineProjection(flow, { expose: { context: ['total'] } })
    expect(projection).toEqual({ '~types': undefined, flow, expose: { context: ['total'] } })
    expect(projection.flow).toBe(flow)
    expect(defineProjection(child, { expose: {} }).flow).toBe(child)
  })

  it('wizard.project() rejects a projection of a same-name, same-shape flow (identity, not name)', async () => {
    const twinBuilder = defineFlow({
      name: 'root',
      context: z.object({ cartId: z.string(), total: z.number(), secret: z.string() }),
    })
    const twin = twinBuilder.steps(
      {
        form: twinBuilder.view({ input: z.object({ address: z.string() }), next: 'reserve' }),
        reserve: twinBuilder.task(async () => ({ reservationId: 'r' }), { next: 'sub' }),
        sub: twinBuilder.flow(child, { context: () => ({ n: 1, childSecret: 's' }), next: 'done' }),
        done: twinBuilder.final({ output: () => ({ receipt: 1 }) }),
      },
      { start: 'form' },
    )
    const twinProjection = defineProjection(twin, { expose: { context: ['total'] } })
    const wizard = createWizard(flow, { context: { cartId: 'c', total: 1, secret: 's' } })
    // Type-compatible (structural), rejected at runtime (identity).
    expect(() => wizard.project(twinProjection)).toThrow(WizardError)
    try {
      wizard.project(twinProjection)
    } catch (error) {
      expect((error as WizardError).code).toBe('DEFINITION_INVALID')
      expect((error as WizardError).message).toContain('different flow object')
    }
    expect(
      wizard.project(defineProjection(flow, { expose: { context: ['total'] } })).context,
    ).toEqual({ total: 1 })
    wizard.dispose()
  })
})

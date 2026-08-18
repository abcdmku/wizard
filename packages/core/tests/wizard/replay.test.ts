/**
 * `replay(flow, events, options)` — the public fold. Property: for a fresh wizard whose log was
 * not truncated, `replay(flow, wizard.log(), { context, instanceId })` deep-equals
 * `wizard.getState()` at every point (`upTo`), through views, a fan-out DAG with a retried task,
 * a wait step with events, a nested flow (child events skipped, summaries folded), context
 * patches, `reset()`, and a `from` base state.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { defineFlow } from '../../src/authoring/define-flow'
import { createSequentialIds } from '../../src/interpreter/env'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { replay } from '../../src/replay'
import { createWizard, type Wizard, type WizardEvent } from '../../src/wizard/create-wizard'

const settle = () => new Promise<void>((r) => setTimeout(r, 0))

// ---- fixtures ------------------------------------------------------------------------------

const packFlow = (() => {
  const c = defineFlow({ name: 'pack', context: z.object({ items: z.number() }) })
  return c.steps(
    {
      count: c.task(({ context }) => context.items * 2, { next: 'packed' }),
      packed: c.final({ output: ({ steps }) => steps.count?.output }),
    },
    { start: 'count' },
  )
})()

interface Deps {
  api: { fetch(): Promise<number> }
}

const s = defineFlow({
  name: 'replay-fixture',
  context: z.object({
    order: z.string(),
    total: z.number().default(0),
    rows: z.number().optional(),
    quality: z.number().default(0),
  }),
  events: { 'payment.captured': z.object({ paymentId: z.string() }) },
  deps: boundary.trusted<Deps>(),
  concurrency: 2,
})

const flow = s.steps(
  {
    form: s.view({
      input: z.object({ name: z.string().min(1) }),
      initial: { name: '' },
      exit: ({ update }) => update({ total: 10 }),
      next: 'ingest',
    }),
    ingest: s.task(
      async ({ deps, update }) => {
        const rows = await deps.api.fetch()
        update({ rows })
        return { rows }
      },
      { retry: { attempts: 2, backoff: 100 }, next: ['normalize', 'enrich'] },
    ),
    normalize: s.task(({ context }) => ({ normalized: context.rows ?? 0 }), { next: 'gate' }),
    enrich: s.task(({ update }) => update({ quality: 0.9 }), {
      when: ({ context }) => (context.rows ?? 0) > 0,
      next: 'gate',
    }),
    gate: s.decision({
      dependsOn: ['normalize', 'enrich'],
      next: ({ context }) => (context.quality >= 0.8 ? 'awaitPayment' : 'rejected'),
    }),
    awaitPayment: s.wait({
      on: { 'payment.captured': ({ update, payload }) => update({ order: payload.paymentId }) },
      timeout: { after: '15m', next: 'rejected' },
      next: 'pack',
    }),
    pack: s.flow(packFlow, {
      context: ({ context }) => ({ items: context.rows ?? 0 }),
      next: 'done',
    }),
    rejected: s.final({ output: () => 'rejected' }),
    done: s.final({ output: ({ context }) => `stored ${context.rows ?? 0} rows` }),
  },
  { start: 'form' },
)

const context = { order: 'o-1' }

function make(fetch: () => Promise<number>) {
  const sched = createTestScheduler({ now: 1_000 })
  const wizard = createWizard(flow, {
    context,
    deps: { api: { fetch } },
    scheduler: sched,
    ids: createSequentialIds(),
    logSize: 1_000,
  })
  return { wizard, sched }
}

/** `replay` of the whole log equals the live state, and every prefix (`upTo`) is consistent too. */
function expectReplayEquals(wizard: Wizard<typeof flow>, log: readonly WizardEvent<typeof flow>[]) {
  const replayed = replay(flow, log, { context, instanceId: wizard.id })
  expect(replayed).toEqual(wizard.getState())
  // Prefix property: the fold up to seq N equals the fold of the events with seq <= N.
  const last = log[log.length - 1]
  if (last !== undefined) {
    const mid = Math.floor(last.seq / 2)
    const partial = replay(flow, log, { context, instanceId: wizard.id, upTo: mid })
    const prefix = replay(
      flow,
      log.filter((e) => e.seq <= mid),
      { context, instanceId: wizard.id },
    )
    expect(partial).toEqual(prefix)
    expect(partial.seq).toBeLessThanOrEqual(mid)
  }
}

// ---- tests ---------------------------------------------------------------------------------

describe('replay(flow, log, { context }) == getState()', () => {
  it('through a view, a retried task, a fan-out DAG with a skipped branch, a wait and a nested flow', async () => {
    let calls = 0
    const { wizard, sched } = make(async () => {
      calls += 1
      if (calls === 1) throw new Error('flaky')
      return 100
    })
    await wizard.start()
    expectReplayEquals(wizard, wizard.log())

    await wizard.setInput('form', { name: 'ada' })
    expect(await wizard.next()).toMatchObject({ ok: true, to: 'ingest' })
    await settle()
    expectReplayEquals(wizard, wizard.log())
    // First attempt failed → retry timer; advance and let the second attempt succeed.
    expect(wizard.getState().steps.ingest.retryAt).toBeDefined()
    sched.advance(100)
    await settle()
    await settle()
    expectReplayEquals(wizard, wizard.log())
    expect(wizard.getState().steps.gate.status).toBe('done')
    expect(wizard.getState().steps.awaitPayment.status).toBe('active')

    // A wait step: the event patches the context and moves on to the nested flow.
    expect(await wizard.send('payment.captured', { paymentId: 'pay-9' })).toMatchObject({
      ok: true,
    })
    await settle()
    await settle()
    expectReplayEquals(wizard, wizard.log())
    expect(wizard.getState().status).toBe('done')
    expect(wizard.getState().output).toBe('stored 100 rows')
    // The child ran (its events are forwarded to observe(), not part of the root log).
    expect(wizard.getState().steps.pack.child?.status).toBe('done')
    wizard.dispose()
  })

  it('folds a captured observe() stream (child events skipped) and survives reset()', async () => {
    const { wizard } = make(async () => 3)
    const captured: WizardEvent<typeof flow>[] = []
    wizard.observe((e) => captured.push(e))
    await wizard.start()
    await wizard.setInput('form', { name: 'ada' })
    await wizard.next()
    await settle()
    await settle()
    // Resolve the wait and finish through the child flow.
    await wizard.send('payment.captured', { paymentId: 'p' })
    await settle()
    await settle()
    expect(wizard.getState().status).toBe('done')
    expect(captured.some((e) => e.path.length > 0)).toBe(true) // child events are in the stream
    expect(replay(flow, captured, { context, instanceId: wizard.id })).toEqual(wizard.getState())

    await wizard.reset()
    expect(replay(flow, captured, { context, instanceId: wizard.id })).toEqual(wizard.getState())
    await wizard.start()
    expect(replay(flow, captured, { context, instanceId: wizard.id })).toEqual(wizard.getState())
    wizard.dispose()
  })

  it('`from` folds onto a base state (only later events), `upTo` stops the fold', async () => {
    const { wizard } = make(async () => 5)
    await wizard.start()
    const base = wizard.getState()
    const baseSeq = base.seq
    await wizard.setInput('form', { name: 'ada' })
    await wizard.next()
    await settle()
    await settle()
    const log = wizard.log()
    // From the base: events with seq <= base.seq are ignored, the rest fold onto it.
    expect(replay(flow, log, { from: base })).toEqual(wizard.getState())
    // The same, from a log that lost its head (a bounded ring / a late attach).
    const tail = log.filter((e) => e.seq > baseSeq)
    expect(replay(flow, tail, { from: base })).toEqual(wizard.getState())
    // upTo = base.seq → nothing applied.
    expect(replay(flow, log, { from: base, upTo: baseSeq })).toBe(base)
    // upTo in the middle: seq never exceeds it and the result is a real intermediate state.
    const mid = replay(flow, log, { context, instanceId: wizard.id, upTo: baseSeq + 3 })
    expect(mid.seq).toBeLessThanOrEqual(baseSeq + 3)
    expect(mid.seq).toBeGreaterThan(baseSeq)
    wizard.dispose()
  })

  it('parses the context through the boundary and rejects a bad one at the door', () => {
    const state = replay(flow, [], { context: { order: 'x' } })
    expect(state.context).toEqual({ order: 'x', total: 0, quality: 0 })
    expect(state.seq).toBe(0)
    expect(state.status).toBe('idle')
    expect(state.instanceId).toBe('replay')
    expect(
      replay(flow, [], { context: { order: 'x' }, instanceId: 'w-1', correlationId: 'c-1' }),
    ).toMatchObject({
      instanceId: 'w-1',
      correlationId: 'c-1',
    })
    expect(() => replay(flow, [], { context: { order: 42 } as never })).toThrowError(
      /context rejected/,
    )
  })
})

/**
 * `replay(flow, events, options)` — the public fold. Property: for a fresh run whose log was
 * not truncated, `replay(flow, run.log(), { context, instanceId })` deep-equals
 * `run.getState()` at every point (`upTo`), through views, a fan-out DAG with a retried task,
 * a wait step with events, a nested flow (child events skipped, summaries folded), context
 * patches, `reset()`, and a `from` base state.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { createSequentialIds } from '../../src/interpreter/env'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { replay } from '../../src/replay'
import type { Run, RunEvent } from '../../src/wizard/create-wizard'
import { defineWizard } from '../../src/wizard/define-wizard'

const settle = () => new Promise<void>((r) => setTimeout(r, 0))

// ---- fixtures ------------------------------------------------------------------------------

const packFlow = defineWizard(
  { name: 'pack', context: z.object({ items: z.number() }) },
  ({ step, steps }) => {
    const count = step({ run: ({ context }) => context.items * 2, next: 'packed' })
    return steps(
      { count, packed: step({ needs: { count }, run: ({ needs }) => needs.count }) },
      { start: 'count' },
    )
  },
)

interface Deps {
  api: { fetch(): Promise<number> }
}

const flow = defineWizard(
  {
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
  },
  ({ step, view, child: childFlow, steps }) => {
    const normalize = step({
      run: ({ context }) => ({ normalized: context.rows ?? 0 }),
      next: 'gate',
    })
    const enrich = step({
      run: ({ update }) => update({ quality: 0.9 }),
      when: ({ context }) => (context.rows ?? 0) > 0,
      next: 'gate',
    })
    return steps(
      {
        form: view({
          input: z.object({ name: z.string().min(1) }),
          initial: { name: '' },
          exit: ({ update }) => update({ total: 10 }),
          next: 'ingest',
        }),
        ingest: step({
          run: async ({ deps, update }) => {
            const rows = await deps.api.fetch()
            update({ rows })
            return { rows }
          },
          retry: { retries: 2, backoff: 100 },
          next: ['normalize', 'enrich'],
        }),
        normalize,
        enrich,
        gate: step({
          needs: { normalize, enrich: { optional: enrich } },
          next: ({ context }) => (context.quality >= 0.8 ? 'awaitPayment' : 'rejected'),
          targets: ['awaitPayment', 'rejected'],
        }),
        awaitPayment: step({
          waitFor: {
            'payment.captured': ({ update, payload }) => {
              update({ order: payload.paymentId })
              return { done: payload }
            },
          },
          timeout: { after: '15m', next: 'rejected' },
          next: 'pack',
        }),
        pack: childFlow(packFlow, {
          context: ({ context }) => ({ items: context.rows ?? 0 }),
          next: 'done',
        }),
        rejected: step({ run: () => 'rejected' }),
        done: step({ run: ({ context }) => `stored ${context.rows ?? 0} rows` }),
      },
      { start: 'form' },
    )
  },
)

const context = { order: 'o-1' }

function make(fetch: () => Promise<number>) {
  const sched = createTestScheduler({ now: 1_000 })
  const run = flow.create(context, {
    deps: { api: { fetch } },
    scheduler: sched,
    ids: createSequentialIds(),
    logSize: 1_000,
  })
  return { run, sched }
}

/** `replay` of the whole log equals the live state, and every prefix (`upTo`) is consistent too. */
function expectReplayEquals(run: Run<typeof flow>, log: readonly RunEvent<typeof flow>[]) {
  const replayed = replay(flow, log, { context, instanceId: run.id })
  expect(replayed).toEqual(run.getState())
  // Prefix property: the fold up to seq N equals the fold of the events with seq <= N.
  const last = log[log.length - 1]
  if (last !== undefined) {
    const mid = Math.floor(last.seq / 2)
    const partial = replay(flow, log, { context, instanceId: run.id, upTo: mid })
    const prefix = replay(
      flow,
      log.filter((e) => e.seq <= mid),
      { context, instanceId: run.id },
    )
    expect(partial).toEqual(prefix)
    expect(partial.seq).toBeLessThanOrEqual(mid)
  }
}

// ---- tests ---------------------------------------------------------------------------------

describe('replay(flow, log, { context }) == getState()', () => {
  it('through a view, a retried step, a fan-out DAG with a skipped branch, a wait and a nested flow', async () => {
    let calls = 0
    const { run, sched } = make(async () => {
      calls += 1
      if (calls === 1) throw new Error('flaky')
      return 100
    })
    await run.start()
    expectReplayEquals(run, run.log())

    await run.setInput('form', { name: 'ada' })
    expect(await run.next()).toMatchObject({ ok: true, to: 'ingest' })
    await settle()
    expectReplayEquals(run, run.log())
    // First attempt failed → retry timer; advance and let the second attempt succeed.
    expect(run.getState().steps.ingest.retryAt).toBeDefined()
    sched.advance(100)
    await settle()
    await settle()
    expectReplayEquals(run, run.log())
    expect(run.getState().steps.gate.status).toBe('done')
    expect(run.getState().steps.awaitPayment.status).toBe('active')

    // A wait step: the event patches the context and moves on to the nested flow.
    expect(await run.send('payment.captured', { paymentId: 'pay-9' })).toMatchObject({
      ok: true,
    })
    await settle()
    await settle()
    expectReplayEquals(run, run.log())
    expect(run.getState().status).toBe('done')
    expect(run.getState().output).toBe('stored 100 rows')
    // The child ran (its events are forwarded to observe(), not part of the root log).
    expect(run.getState().steps.pack.child?.status).toBe('done')
    run.dispose()
  })

  it('folds a captured observe() stream (child events skipped) and survives reset()', async () => {
    const { run } = make(async () => 3)
    const captured: RunEvent<typeof flow>[] = []
    run.observe((e) => captured.push(e))
    await run.start()
    await run.setInput('form', { name: 'ada' })
    await run.next()
    await settle()
    await settle()
    // Resolve the wait and finish through the child flow.
    await run.send('payment.captured', { paymentId: 'p' })
    await settle()
    await settle()
    expect(run.getState().status).toBe('done')
    expect(captured.some((e) => e.path.length > 0)).toBe(true) // child events are in the stream
    expect(replay(flow, captured, { context, instanceId: run.id })).toEqual(run.getState())

    await run.reset()
    expect(replay(flow, captured, { context, instanceId: run.id })).toEqual(run.getState())
    await run.start()
    expect(replay(flow, captured, { context, instanceId: run.id })).toEqual(run.getState())
    run.dispose()
  })

  it('`from` folds onto a base state (only later events), `upTo` stops the fold', async () => {
    const { run } = make(async () => 5)
    await run.start()
    const base = run.getState()
    const baseSeq = base.seq
    await run.setInput('form', { name: 'ada' })
    await run.next()
    await settle()
    await settle()
    const log = run.log()
    // From the base: events with seq <= base.seq are ignored, the rest fold onto it.
    expect(replay(flow, log, { from: base })).toEqual(run.getState())
    // The same, from a log that lost its head (a bounded ring / a late attach).
    const tail = log.filter((e) => e.seq > baseSeq)
    expect(replay(flow, tail, { from: base })).toEqual(run.getState())
    // upTo = base.seq → nothing applied.
    expect(replay(flow, log, { from: base, upTo: baseSeq })).toBe(base)
    // upTo in the middle: seq never exceeds it and the result is a real intermediate state.
    const mid = replay(flow, log, { context, instanceId: run.id, upTo: baseSeq + 3 })
    expect(mid.seq).toBeLessThanOrEqual(baseSeq + 3)
    expect(mid.seq).toBeGreaterThan(baseSeq)
    run.dispose()
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

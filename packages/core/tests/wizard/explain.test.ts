/**
 * `run.explain(step)` — the machine's `explain` query through the typed façade and the
 * runtime: reason codes before start, for gated / not-activated steps, failed tasks, the
 * `candidates` list, unknown ids, and that it stays callable after `dispose()`.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { createSequentialIds } from '../../src/interpreter/env'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import type { Explanation } from '../../src/wizard/create-wizard'
import { defineWizard } from '../../src/wizard/define-wizard'

const flow = defineWizard(
  {
    name: 'explain',
    context: boundary.trusted<{ ok: boolean }>(),
    autoRun: 'ready',
  },
  ({ step, view, steps }) => {
    const a = view({ next: 'join' })
    const b = view({ canEnter: ({ context }) => context.ok, next: 'join' })
    return steps(
      {
        form: view({ input: z.object({ name: z.string() }), next: ['a', 'b'] }),
        a,
        b,
        join: step({ run: () => 'joined', needs: { a, b }, next: 'boom' }),
        boom: step({
          run: () => {
            throw new Error('nope')
          },
          next: 'end',
        }),
        end: step({ next: null }),
      },
      { start: 'form' },
    )
  },
)

function make(ok = true) {
  return flow.create(
    { ok },
    {
      scheduler: createTestScheduler({ now: 1_000 }),
      ids: createSequentialIds(),
    },
  )
}

describe('run.explain()', () => {
  it('reports flow-not-started before start(), then the cursor view once started', async () => {
    const run = make()
    expect(run.explain('form')).toEqual({
      status: 'idle',
      phase: undefined,
      reasons: ['flow-not-started', 'not-activated'],
      candidates: [],
      waitingFor: [],
    })
    await run.start()
    const explained: Explanation<typeof flow> = run.explain('form')
    expect(explained).toMatchObject({ status: 'active', phase: 'waiting', reasons: [] })
    // Not yet arrived anywhere else.
    expect(run.explain('join').reasons).toEqual(['not-activated', 'deps-unmet:a', 'deps-unmet:b'])
    run.dispose()
  })

  it('lists ready views as candidates after a fan-out and unmet deps for the join', async () => {
    const run = make()
    await run.start()
    await run.setInput('form', { name: 'ada' })
    expect(await run.next()).toMatchObject({ ok: true, to: 'a' })
    // `a` is current; `b` is ready and reachable via go() → it is a candidate for the cursor.
    expect(run.explain('a')).toMatchObject({ status: 'active', reasons: [], candidates: ['b'] })
    expect(run.explain('b')).toMatchObject({
      status: 'idle',
      phase: 'ready',
      reasons: [],
      candidates: ['b'],
    })
    // Nothing arrived at the join yet: not activated, both deps unmet, no live phase.
    expect(run.explain('join')).toMatchObject({
      status: 'idle',
      phase: undefined,
      reasons: ['not-activated', 'deps-unmet:a', 'deps-unmet:b'],
    })
    // `a` completes and arrives at the join: activation is pending, gated on `b` → blocked.
    // The cursor rule then moves the cursor to `b` (the only ready view) in the same batch, but
    // `next()` reports the USER transaction (a → join), not the auto one.
    expect(await run.next()).toMatchObject({ ok: true, from: 'a', to: 'join' })
    expect(run.getState().current).toBe('b')
    expect(run.explain('join')).toMatchObject({
      status: 'idle',
      phase: 'blocked',
      reasons: ['deps-unmet:b'],
      candidates: [],
    })
    run.dispose()
  })

  it('records guard-false:canEnter after a rejected transition and failed:<kind> for a failed task', async () => {
    const run = make(false)
    await run.start()
    await run.setInput('form', { name: 'ada' })
    // Fan-out is atomic: `b.canEnter` is false → the whole transition is rejected.
    expect(await run.next()).toMatchObject({ ok: false, reason: 'guard-canEnter', step: 'b' })
    expect(run.explain('b').reasons).toContain('guard-false:canEnter')

    const ok = make(true)
    await ok.start()
    await ok.setInput('form', { name: 'ada' })
    await ok.next() // form → [a, b]; cursor on a
    await ok.next() // a → join (gated on b); cursor moves to b (only ready view)
    await ok.next() // b → join runs → boom fails (halt)
    expect(ok.getState().status).toBe('halted')
    // A halt failure is recoverable (`retry()`), so the flow is not terminal — only the step is.
    expect(ok.explain('boom')).toMatchObject({
      status: 'failed',
      reasons: ['flow-halted', 'failed:run'],
    })
    expect(ok.explain('end').reasons).toEqual(['flow-halted', 'not-activated'])
    ok.dispose()
    run.dispose()
  })

  it('an unknown id is status unknown (never throws), and explain works after dispose()', async () => {
    const run = make()
    await run.start()
    expect(run.explain('nope' as never)).toEqual({
      status: 'unknown',
      phase: undefined,
      reasons: ['unknown-step'],
      candidates: [],
      waitingFor: [{ kind: 'view', path: [], step: 'form' }],
    })
    run.dispose()
    expect(run.explain('form').status).toBe('active')
  })
})

/**
 * `wizard.explain(step)` — the machine's `explain` query through the typed façade and the
 * runtime: reason codes before start, for gated / not-activated steps, failed tasks, the
 * `candidates` list, unknown ids, and that it stays callable after `dispose()`.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { defineFlow } from '../../src/authoring/define-flow'
import { createSequentialIds } from '../../src/interpreter/env'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { createWizard, type Explanation } from '../../src/wizard/create-wizard'

const s = defineFlow({
  name: 'explain',
  context: boundary.trusted<{ ok: boolean }>(),
  autoRun: 'ready',
})
const flow = s.steps(
  {
    form: s.view({ input: z.object({ name: z.string() }), next: ['a', 'b'] }),
    a: s.view({ next: 'join' }),
    b: s.view({ canEnter: ({ context }) => context.ok, next: 'join' }),
    join: s.task(() => 'joined', { dependsOn: ['a', 'b'], next: 'boom' }),
    boom: s.task(
      () => {
        throw new Error('nope')
      },
      { next: 'end' },
    ),
    end: s.final(),
  },
  { start: 'form' },
)

function make(ok = true) {
  return createWizard(flow, {
    context: { ok },
    scheduler: createTestScheduler({ now: 1_000 }),
    ids: createSequentialIds(),
  })
}

describe('wizard.explain()', () => {
  it('reports flow-not-started before start(), then the cursor view once started', async () => {
    const wizard = make()
    expect(wizard.explain('form')).toEqual({
      status: 'idle',
      phase: undefined,
      reasons: ['flow-not-started', 'not-activated'],
      candidates: [],
    })
    await wizard.start()
    const explained: Explanation<typeof flow> = wizard.explain('form')
    expect(explained).toMatchObject({ status: 'active', phase: 'waiting', reasons: [] })
    // Not yet arrived anywhere else.
    expect(wizard.explain('join').reasons).toEqual([
      'not-activated',
      'deps-unmet:a',
      'deps-unmet:b',
    ])
    wizard.dispose()
  })

  it('lists ready views as candidates after a fan-out and unmet deps for the join', async () => {
    const wizard = make()
    await wizard.start()
    await wizard.setInput('form', { name: 'ada' })
    expect(await wizard.next()).toMatchObject({ ok: true, to: 'a' })
    // `a` is current; `b` is ready and reachable via go() → it is a candidate for the cursor.
    expect(wizard.explain('a')).toMatchObject({ status: 'active', reasons: [], candidates: ['b'] })
    expect(wizard.explain('b')).toMatchObject({
      status: 'idle',
      phase: 'ready',
      reasons: [],
      candidates: ['b'],
    })
    // Nothing arrived at the join yet: not activated, both deps unmet, no live phase.
    expect(wizard.explain('join')).toMatchObject({
      status: 'idle',
      phase: undefined,
      reasons: ['not-activated', 'deps-unmet:a', 'deps-unmet:b'],
    })
    // `a` completes and arrives at the join: activation is pending, gated on `b` → blocked.
    // The cursor rule then moves the cursor to `b` (the only ready view) in the same batch, but
    // `next()` reports the USER transaction (a → join), not the auto one.
    expect(await wizard.next()).toMatchObject({ ok: true, from: 'a', to: 'join' })
    expect(wizard.getState().current).toBe('b')
    expect(wizard.explain('join')).toMatchObject({
      status: 'idle',
      phase: 'blocked',
      reasons: ['deps-unmet:b'],
      candidates: [],
    })
    wizard.dispose()
  })

  it('records guard-false:canEnter after a rejected transition and failed:<kind> for a failed task', async () => {
    const wizard = make(false)
    await wizard.start()
    await wizard.setInput('form', { name: 'ada' })
    // Fan-out is atomic: `b.canEnter` is false → the whole transition is rejected.
    expect(await wizard.next()).toMatchObject({ ok: false, reason: 'guard-canEnter', step: 'b' })
    expect(wizard.explain('b').reasons).toContain('guard-false:canEnter')

    const ok = make(true)
    await ok.start()
    await ok.setInput('form', { name: 'ada' })
    await ok.next() // form → [a, b]; cursor on a
    await ok.next() // a → join (gated on b); cursor moves to b (only ready view)
    await ok.next() // b → join runs → boom fails (halt)
    expect(ok.getState().status).toBe('failed')
    // A halt failure is recoverable (`retry()`), so the flow is not terminal — only the step is.
    expect(ok.explain('boom')).toMatchObject({ status: 'failed', reasons: ['failed:run'] })
    expect(ok.explain('end').reasons).toEqual(['not-activated'])
    ok.dispose()
    wizard.dispose()
  })

  it('an unknown id is status unknown (never throws), and explain works after dispose()', async () => {
    const wizard = make()
    await wizard.start()
    expect(wizard.explain('nope' as never)).toEqual({
      status: 'unknown',
      phase: undefined,
      reasons: ['unknown-step'],
      candidates: [],
    })
    wizard.dispose()
    expect(wizard.explain('form').status).toBe('active')
  })
})

/**
 * v0.2 wire shapes: `skip { step, reason? }` and `invalidate { step, cascade? }` — exact
 * allow-lists, id checks against the flow, and the boolean `cascade`.
 */
import { describe, expect, it } from 'vitest'
import { decodeCommand } from '../../src/wizard/parse-command'
import { validateSnapshot } from '../../src/wizard/snapshot'
import { createHarness, final, flow, task, view } from '../helpers/fixtures'

const def = flow({
  start: 'a',
  steps: { a: view({ next: 't' }), t: task({ next: 'end' }), end: final() },
})

describe('decodeCommand — skip / invalidate (v0.2)', () => {
  it('accepts the shapes (with and without optional fields) and checks the step id when a flow is given', () => {
    expect(decodeCommand({ type: 'skip', step: 't' }, def)).toEqual({
      ok: true,
      value: { type: 'skip', step: 't' },
    })
    expect(decodeCommand({ type: 'skip', step: 't', reason: 'why' }, def)).toEqual({
      ok: true,
      value: { type: 'skip', step: 't', reason: 'why' },
    })
    expect(decodeCommand({ type: 'invalidate', step: 't' }, def)).toEqual({
      ok: true,
      value: { type: 'invalidate', step: 't' },
    })
    expect(decodeCommand({ type: 'invalidate', step: 't', cascade: false }, def)).toEqual({
      ok: true,
      value: { type: 'invalidate', step: 't', cascade: false },
    })
    // shape-only decoding (no flow) does not check ids
    expect(decodeCommand({ type: 'skip', step: 'zzz' })).toMatchObject({ ok: true })
  })

  it('rejects unknown ids, missing/empty step, non-boolean cascade and unknown properties', () => {
    const msg = (r: ReturnType<typeof decodeCommand>) =>
      r.ok ? [] : r.issues.map((i) => i.message)
    expect(msg(decodeCommand({ type: 'skip', step: 'zzz' }, def))).toEqual(["unknown step 'zzz'"])
    expect(msg(decodeCommand({ type: 'skip' }, def))).toEqual(["'step' is required"])
    expect(msg(decodeCommand({ type: 'skip', step: '' }, def))).toEqual([
      "'step' must be a non-empty string",
    ])
    expect(msg(decodeCommand({ type: 'invalidate', step: 't', cascade: 'yes' }, def))).toEqual([
      "'cascade' must be a boolean",
    ])
    expect(msg(decodeCommand({ type: 'invalidate', step: 't', reason: 'x' }, def))).toEqual([
      "unknown property 'reason' on 'invalidate'",
    ])
    expect(msg(decodeCommand({ type: 'skip', step: 't', cascade: true }, def))).toEqual([
      "unknown property 'cascade' on 'skip'",
    ])
  })
})

describe('validateSnapshot — v0.2 fields', () => {
  it('accepts correlationId / when / cursorHint / skipReason / previousOutput and rejects malformed ones', () => {
    const h = createHarness(def, { correlationId: 'c1' })
    h.start()
    const base = JSON.parse(JSON.stringify(h.state))
    const snap = (state: unknown) => ({
      v: 1,
      flow: { name: 'test', version: 1 },
      instanceId: 'inst-1',
      epoch: 0,
      seq: h.state.seq,
      savedAt: 1,
      state,
      children: {},
    })
    expect(validateSnapshot(def, snap(base))).toMatchObject({ ok: true })
    const withV2 = {
      ...base,
      nav: { ...base.nav, cursorHint: 'a' },
      steps: {
        ...base.steps,
        t: { ...base.steps.t, when: 'pending', skipReason: 'command', previousOutput: 1 },
      },
    }
    expect(validateSnapshot(def, snap(withV2))).toMatchObject({ ok: true })
    const reasons = (state: unknown) => {
      const r = validateSnapshot(def, snap(state))
      return r.ok ? [] : r.reasons
    }
    expect(reasons({ ...base, correlationId: 7 })).toEqual([
      'state.correlationId: expected a string',
    ])
    expect(reasons({ ...base, nav: { ...base.nav, cursorHint: 't' } })).toEqual([
      "state.nav.cursorHint: expected a view id, got 't'",
    ])
    expect(
      reasons({ ...base, steps: { ...base.steps, t: { ...base.steps.t, when: 'maybe' } } }),
    ).toEqual(["state.steps.t.when: expected 'pending' | 'passed', got 'maybe'"])
    expect(
      reasons({ ...base, steps: { ...base.steps, t: { ...base.steps.t, skipReason: 1 } } }),
    ).toEqual(['state.steps.t.skipReason: expected a string'])
  })
})

import { describe, expect, it } from 'vitest'
import type { WizardState } from '../../src/machine/state'
import { type Snapshot, toSnapshot, validateSnapshot } from '../../src/wizard/snapshot'
import { flow, initialState, testEnv, trusted } from '../helpers/fake-machine'

const child = flow({ name: 'child', steps: { c: { kind: 'view' } } })
const def = flow({
  name: 'main',
  version: 2,
  events: { ping: trusted },
  steps: {
    a: { kind: 'view', next: { kind: 'static', targets: ['f'] } },
    f: { kind: 'flow', child },
    end: { kind: 'final' },
  },
})

function base(patch: (s: WizardState) => WizardState = (s) => s): Snapshot {
  const state = patch(initialState(testEnv(def), { instanceId: 'i1', context: { x: 1 }, now: 5 }))
  return toSnapshot(state, {}, 99)
}

const reasonsOf = (input: unknown) => {
  const r = validateSnapshot(def, input)
  return r.ok ? [] : r.reasons
}

describe('toSnapshot / validateSnapshot', () => {
  it('wraps state in the versioned envelope and accepts it back', () => {
    const snap = base()
    expect(snap).toMatchObject({
      v: 1,
      flow: { name: 'main', version: 2 },
      instanceId: 'i1',
      epoch: 0,
      seq: 0,
      savedAt: 99,
    })
    expect(snap.children).toEqual({})
    const r = validateSnapshot(def, snap)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.snapshot).toBe(snap)
    // Also after a JSON round trip.
    expect(validateSnapshot(def, JSON.parse(JSON.stringify(snap))).ok).toBe(true)
  })

  it('accepts a consistent active/current/history state', () => {
    const snap = base((s) => ({
      ...s,
      status: 'waiting',
      current: 'a',
      active: ['a'],
      history: ['a'],
      startedAt: 5,
      steps: { ...s.steps, a: { ...s.steps.a!, status: 'active', runId: 1, visitedCount: 1 } },
    }))
    expect(reasonsOf(snap)).toEqual([])
  })

  it('rejects a bad envelope', () => {
    expect(reasonsOf(null)).toEqual(['snapshot: expected an object'])
    expect(reasonsOf({ ...base(), v: 2 })).toContain('v: expected 1, got 2')
    expect(reasonsOf({ ...base(), instanceId: '' })).toContain(
      'instanceId: expected a non-empty string',
    )
    expect(reasonsOf({ ...base(), seq: -1 })).toContain('seq: expected a non-negative integer')
    expect(reasonsOf({ ...base(), children: 'x' })).toContain('children: expected an object')
    expect(reasonsOf({ ...base(), state: 1 })).toEqual(['state: expected an object'])
  })

  it('rejects wrong flow identity (name / version), on the envelope and in state', () => {
    expect(reasonsOf({ ...base(), flow: { name: 'other', version: 2 } })).toContain(
      "flow.name: expected 'main', got 'other'",
    )
    expect(reasonsOf({ ...base(), flow: { name: 'main', version: 1 } })).toContain(
      'flow.version: expected 2, got 1',
    )
    const snap = base()
    expect(
      reasonsOf({ ...snap, state: { ...snap.state, flow: { name: 'main', version: 3 } } }),
    ).toContain('state.flow: expected main@2')
  })

  it('rejects step-set drift (missing / unknown steps) and kind mismatches', () => {
    const snap = base()
    const { a: _a, ...withoutA } = snap.state.steps
    expect(reasonsOf({ ...snap, state: { ...snap.state, steps: withoutA } })).toContain(
      "state.steps: missing step 'a'",
    )
    expect(
      reasonsOf({
        ...snap,
        state: { ...snap.state, steps: { ...snap.state.steps, zz: snap.state.steps.a } },
      }),
    ).toContain("state.steps: unknown step 'zz'")
    expect(
      reasonsOf({
        ...snap,
        state: {
          ...snap.state,
          steps: { ...snap.state.steps, a: { ...snap.state.steps.a!, kind: 'task' } },
        },
      }),
    ).toContain("state.steps.a.kind: expected 'view', got 'task'")
  })

  it('rejects status invariant violations', () => {
    const snap = base()
    const s = snap.state
    expect(reasonsOf({ ...snap, state: { ...s, status: 'bogus' } })).toContain(
      "state.status: unknown status 'bogus'",
    )
    expect(reasonsOf({ ...snap, state: { ...s, active: ['a'] } })).toContain(
      "state.steps.a: listed in state.active but status is 'idle'",
    )
    expect(
      reasonsOf({
        ...snap,
        state: { ...s, steps: { ...s.steps, a: { ...s.steps.a!, status: 'active' } } },
      }),
    ).toContain('state.steps.a: active but missing from state.active')
    expect(reasonsOf({ ...snap, state: { ...s, current: 'a' } })).toContain(
      "state.current: 'a' is not active",
    )
    expect(reasonsOf({ ...snap, state: { ...s, current: 'end' } })).toContain(
      "state.current: 'end' is not a view",
    )
    expect(reasonsOf({ ...snap, state: { ...s, nav: { phase: 'flying' } } })).toContain(
      "state.nav.phase: unknown phase 'flying'",
    )
    expect(reasonsOf({ ...snap, state: { ...s, history: ['ghost'] } })).toContain(
      "state.history: unknown step 'ghost'",
    )
    expect(reasonsOf({ ...snap, state: { ...s, seq: 4 } })).toContain(
      'state.seq: expected 0 (envelope seq), got 4',
    )
    expect(
      reasonsOf({
        ...snap,
        state: { ...s, inbox: [{ id: 'e1', event: 'nope', payload: 1, at: 1, expiresAt: 2 }] },
      }),
    ).toContain("state.inbox[0].event: unknown event 'nope'")
    expect(reasonsOf({ ...snap, state: { ...s, timers: { t: { at: 'soon' } } } })).toContain(
      'state.timers.t: expected { at, fire }',
    )
  })

  it('rejects duplicate active entries, non-view history and inconsistent derived status', () => {
    const snap = base()
    const s = snap.state
    const activeA = { ...s.steps, a: { ...s.steps.a!, status: 'active' as const } }
    expect(
      reasonsOf({
        ...snap,
        state: { ...s, status: 'waiting', startedAt: 1, steps: activeA, active: ['a', 'a'] },
      }),
    ).toContain("state.active: duplicate entry 'a'")
    expect(reasonsOf({ ...snap, state: { ...s, history: ['end'] } })).toContain(
      "state.history: 'end' is not a view",
    )
    // done / cancelled / compensating / idle cannot have active steps.
    for (const status of ['done', 'cancelled', 'compensating'] as const) {
      expect(
        reasonsOf({
          ...snap,
          state: { ...s, status, startedAt: 1, steps: activeA, active: ['a'], current: 'a' },
        }),
      ).toContain(`state.status: ${status} but steps are still active`)
    }
    expect(
      reasonsOf({
        ...snap,
        state: { ...s, status: 'idle', steps: activeA, active: ['a'], current: 'a' },
      }),
    ).toContain('state.status: idle but steps are active')
    expect(reasonsOf({ ...snap, state: { ...s, startedAt: 5 } })).toContain(
      'state.status: idle but startedAt is set',
    )
    // running requires an executing kind (task/decision/flow/final), not just a view.
    expect(
      reasonsOf({
        ...snap,
        state: {
          ...s,
          status: 'running',
          startedAt: 1,
          steps: activeA,
          active: ['a'],
          current: 'a',
        },
      }),
    ).toContain('state.status: running without an active task/decision/flow/final step')
  })

  it('validates the saga shapes: SagaEntry stack, SagaEntryRef lists and optional bookkeeping', () => {
    const snap = base()
    const s = snap.state
    const saga = (patch: Record<string, unknown>) =>
      reasonsOf({ ...snap, state: { ...s, saga: { ...s.saga, ...patch } } })
    expect(
      saga({
        stack: [
          { step: 'a', runId: 1, seq: 4, output: { x: 1 } },
          { step: 'f', runId: 2, seq: 9 },
        ],
        compensated: [{ step: 'f', runId: 2 }],
        failures: [{ step: 'a', runId: 1 }],
        settling: ['a'],
        inFlight: { step: 'a', runId: 1 },
        outcome: 'cancelled',
        reason: 'user',
      }),
    ).toEqual([])
    expect(saga({ stack: ['a'] })).toEqual([
      'state.saga.stack[0]: expected { step, runId, seq, output? }',
    ])
    expect(saga({ stack: [{ step: 'ghost', runId: 1, seq: 1 }] })).toEqual([
      'state.saga.stack[0]: expected { step, runId, seq, output? }',
    ])
    expect(saga({ stack: [{ step: 'a', runId: 1 }] })).toEqual([
      'state.saga.stack[0]: expected { step, runId, seq, output? }',
    ])
    expect(saga({ compensated: ['a'] })).toEqual([
      'state.saga.compensated[0]: expected { step, runId }',
    ])
    expect(saga({ failures: [{ step: 'a' }] })).toEqual([
      'state.saga.failures[0]: expected { step, runId }',
    ])
    expect(saga({ failures: 'a' })).toEqual([
      'state.saga.failures: expected an array of { step, runId }',
    ])
    expect(saga({ settling: ['ghost'] })).toEqual([
      'state.saga.settling: expected an array of step ids',
    ])
    expect(saga({ inFlight: 'a' })).toEqual(['state.saga.inFlight: expected { step, runId }'])
    expect(saga({ outcome: 'meh' })).toEqual([
      "state.saga.outcome: expected 'failed' | 'cancelled', got 'meh'",
    ])
    expect(saga({ reason: 5 })).toEqual(['state.saga.reason: expected a string'])
    // `undefined` inside saga entries is still rejected by the JSON walk.
    expect(saga({ stack: [{ step: 'a', runId: 1, seq: 1, output: undefined }] })).toEqual([
      'state.saga.stack[0].output: undefined is not serializable (omit the property instead)',
    ])
  })

  it('validates timer fire messages and metadata', () => {
    const snap = base()
    const s = snap.state
    const ok = { at: 5, fire: { type: 'timer.fired', timerId: 't' }, purpose: 'retry', step: 'a' }
    expect(reasonsOf({ ...snap, state: { ...s, timers: { t: ok } } })).toEqual([])
    expect(
      reasonsOf({ ...snap, state: { ...s, timers: { t: { at: 5, fire: { type: 'next' } } } } }),
    ).toEqual([])
    expect(
      reasonsOf({
        ...snap,
        state: { ...s, timers: { t: { at: 5, fire: { type: 'timer.fired', timerId: 'other' } } } },
      }),
    ).toContain("state.timers.t.fire: expected { type: 'timer.fired', timerId } or a valid command")
    expect(
      reasonsOf({ ...snap, state: { ...s, timers: { t: { at: 5, fire: { type: 'go' } } } } }),
    ).toContain("state.timers.t.fire: expected { type: 'timer.fired', timerId } or a valid command")
    expect(
      reasonsOf({ ...snap, state: { ...s, timers: { t: { ...ok, purpose: 'nap' } } } }),
    ).toContain("state.timers.t.purpose: unknown purpose 'nap'")
    expect(
      reasonsOf({ ...snap, state: { ...s, timers: { t: { ...ok, step: 'ghost' } } } }),
    ).toContain("state.timers.t.step: unknown step 'ghost'")
  })

  it('rejects JSON-unsafe values (functions, non-plain objects, NaN, cycles, undefined)', () => {
    const snap = base()
    const s = snap.state
    expect(reasonsOf({ ...snap, state: { ...s, context: { fn: () => 1 } } })).toContain(
      'state.context.fn: functions are not serializable',
    )
    expect(reasonsOf({ ...snap, state: { ...s, context: { d: new Date(0) } } })).toContain(
      'state.context.d: non-plain object (Date) is not serializable',
    )
    expect(reasonsOf({ ...snap, state: { ...s, context: { n: Number.NaN } } })).toContain(
      'state.context.n: non-finite numbers are not serializable',
    )
    expect(reasonsOf({ ...snap, state: { ...s, context: { big: 1n } } })).toContain(
      'state.context.big: bigint is not serializable',
    )
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(reasonsOf({ ...snap, state: { ...s, context: cyclic } })).toContain(
      'state.context.self: circular reference',
    )
    // `undefined` means "not from a serializer": optional fields must be absent (state contract).
    expect(
      reasonsOf({ ...snap, state: { ...s, context: { u: undefined, list: [1, 'a', null] } } }),
    ).toEqual(['state.context.u: undefined is not serializable (omit the property instead)'])
    expect(
      reasonsOf({
        ...snap,
        state: { ...s, steps: { ...s.steps, a: { ...s.steps.a!, output: undefined } } },
      }),
    ).toEqual(['state.steps.a.output: undefined is not serializable (omit the property instead)'])
    expect(reasonsOf({ ...snap, state: { ...s, context: { list: [1, 'a', null] } } })).toEqual([])
  })

  it('validates children recursively with prefixed reasons', () => {
    const snap = base()
    const childSnap = toSnapshot(
      initialState(testEnv(child), { instanceId: 'c1', context: {}, now: 1 }),
      {},
      1,
    )
    expect(reasonsOf({ ...snap, children: { f: childSnap } })).toEqual([])
    expect(reasonsOf({ ...snap, children: { a: childSnap } })).toContain(
      "children.a: 'a' is not a flow step",
    )
    expect(reasonsOf({ ...snap, children: { f: { ...childSnap, v: 3 } } })).toContain(
      'children.f.v: expected 1, got 3',
    )
  })
})

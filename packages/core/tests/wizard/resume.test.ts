import { describe, expect, it } from 'vitest'
import type { CompiledFlow } from '../../src/authoring/compiled'
import { WizardError } from '../../src/errors'
import { createSequentialIds } from '../../src/interpreter/env'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import type { Effect } from '../../src/machine/effects'
import type { DomainEvent } from '../../src/machine/events'
import { createMemoryStore } from '../../src/persistence/memory-store'
import { prepareResume, resumeWizardRuntime } from '../../src/wizard/resume'
import { createWizardRuntime, type ResumeWizardRuntimeOptions } from '../../src/wizard/runtime'
import type { Snapshot } from '../../src/wizard/snapshot'
import {
  boundary,
  createToyMachine,
  flow,
  initialState,
  stringsBoundary,
  type ToyOverrides,
  types,
} from '../helpers/fake-machine'

const roundTrip = (snap: Snapshot): unknown => JSON.parse(JSON.stringify(snap))

function baseOpts(
  overrides: ToyOverrides = {},
): ResumeWizardRuntimeOptions & { sched: ReturnType<typeof createTestScheduler> } {
  const sched = createTestScheduler({ now: 5_000 })
  return {
    machine: createToyMachine(overrides),
    initialState,
    scheduler: sched,
    ids: createSequentialIds(),
    sched,
  }
}

const twoViews = flow({
  name: 'nav',
  events: { ping: stringsBoundary('id') },
  steps: {
    a: { kind: 'view', input: stringsBoundary('name'), next: { kind: 'static', targets: ['b'] } },
    b: { kind: 'view', next: { kind: 'static', targets: ['end'] } },
    end: { kind: 'final' },
  },
})

async function running(def: CompiledFlow = twoViews) {
  const o = baseOpts()
  const wizard = createWizardRuntime(def, { ...o, context: { tenant: 't' }, instanceId: 'orig' })
  await wizard.start()
  await wizard.next()
  return { wizard, snap: wizard.getSnapshot(), o }
}

const resumeErr = (def: CompiledFlow, input: unknown, opts = baseOpts()) => {
  try {
    resumeWizardRuntime(def, input, opts)
  } catch (error) {
    return error as WizardError
  }
  throw new Error('expected resume to throw')
}

describe('resumeWizardRuntime', () => {
  it('restores state from a JSON round trip, bumps epoch, keeps the id and emits flow.resumed', async () => {
    const { wizard, snap } = await running()
    expect(snap.state.current).toBe('b')
    const events: DomainEvent[] = []
    const o = baseOpts()
    const resumed = resumeWizardRuntime(twoViews, roundTrip(snap), o)
    resumed.observe((e) => events.push(e))
    // observe() attached after construction: the resume batch already happened → check the log.
    expect(types(resumed.log())).toEqual(['flow.resumed'])
    expect(resumed.log()[0]).toMatchObject({
      type: 'flow.resumed',
      fromSeq: snap.seq,
      seq: snap.seq + 1,
    })
    expect(resumed.id).toBe('orig')
    expect(resumed.epoch).toBe(1)
    expect(resumed.getState().current).toBe('b')
    expect(resumed.getState().history).toEqual(['a', 'b'])
    expect(resumed.getState().context).toEqual({ tenant: 't' })
    // Still operational.
    expect(await resumed.next()).toMatchObject({ ok: true, from: 'b', to: 'end' })
    expect(resumed.getState().status).toBe('done')
    wizard.dispose()
  })

  it('re-runs boundaries: context and view outputs are parsed and substituted', async () => {
    const def = flow({
      name: 'nav',
      context: boundary((v) => ({ ok: true, value: { ...(v as object), normalized: true } })),
      steps: {
        a: {
          kind: 'view',
          input: boundary((v) => ({ ok: true, value: { ...(v as object), trimmed: true } })),
          next: { kind: 'static', targets: ['b'] },
        },
        b: { kind: 'view' },
      },
    })
    const { snap } = await running(def)
    const withOutput = {
      ...snap,
      state: {
        ...snap.state,
        steps: { ...snap.state.steps, a: { ...snap.state.steps.a!, output: { name: 'x' } } },
      },
    }
    const resumed = resumeWizardRuntime(def, roundTrip(withOutput), baseOpts())
    expect(resumed.getState().context).toEqual({ tenant: 't', normalized: true })
    expect(resumed.getState().steps.a!.output).toEqual({ name: 'x', trimmed: true })
  })

  it('throws SNAPSHOT_INCOMPATIBLE with one reason per problem', async () => {
    const { snap } = await running()
    const bad = resumeErr(twoViews, { ...snap, v: 2, flow: { name: 'other', version: 1 } })
    expect(bad).toBeInstanceOf(WizardError)
    expect(bad.code).toBe('SNAPSHOT_INCOMPATIBLE')
    expect(bad.issues?.map((i) => i.message)).toEqual(
      expect.arrayContaining(['v: expected 1, got 2', "flow.name: expected 'nav', got 'other'"]),
    )
    expect(bad.message).toContain('SNAPSHOT_INCOMPATIBLE'.length > 0 ? 'not compatible' : '')

    const { end: _end, ...steps } = snap.state.steps
    expect(
      resumeErr(twoViews, { ...snap, state: { ...snap.state, steps } }).issues?.[0]?.message,
    ).toBe("state.steps: missing step 'end'")

    const fn = { ...snap, state: { ...snap.state, context: { evil: () => 1 } } }
    expect(resumeErr(twoViews, fn).issues?.[0]?.message).toBe(
      'state.context.evil: functions are not serializable',
    )

    expect(resumeErr(twoViews, 'garbage').issues?.[0]?.message).toBe('snapshot: expected an object')
  })

  it('reports boundary rejections (view output, inbox payload) and async boundaries as reasons', async () => {
    const { snap } = await running()
    const badOutput = {
      ...snap,
      state: {
        ...snap.state,
        steps: { ...snap.state.steps, a: { ...snap.state.steps.a!, output: { name: 7 } } },
      },
    }
    expect(resumeErr(twoViews, badOutput).issues?.map((i) => i.message)).toEqual([
      'steps.a.output: rejected by boundary (name must be a string)',
    ])
    const badInbox = {
      ...snap,
      state: {
        ...snap.state,
        inbox: [{ id: 'e1', event: 'ping', payload: { id: 1 }, at: 1, expiresAt: 2 }],
      },
    }
    expect(resumeErr(twoViews, badInbox).issues?.map((i) => i.message)).toEqual([
      'inbox[0].payload: rejected by boundary (id must be a string)',
    ])
    const asyncDef = {
      ...twoViews,
      context: boundary((v) => Promise.resolve({ ok: true, value: v }) as any),
    }
    expect(resumeErr(asyncDef, snap).issues?.map((i) => i.message)).toEqual([
      'context: async boundaries are not supported by resumeWizard (use resumeWizardAsync)',
    ])
  })

  it('re-arms persisted timers through the interpreter when the machine plans them on resume', async () => {
    const def = flow({
      name: 'nav',
      steps: {
        w: { kind: 'wait', hooks: { on: {} }, waitTimeout: { afterMs: 1_000, next: 'end' } },
        end: { kind: 'final' },
      },
    })
    const o = baseOpts()
    const wizard = createWizardRuntime(def, { ...o, context: {}, instanceId: 'w' })
    await wizard.start()
    const snap = wizard.getSnapshot()
    expect(Object.keys(snap.state.timers)).toEqual(['wait:w'])
    wizard.dispose()

    // Machine spec §8: `plan` re-arms every `S.timers` entry on flow.resumed (overdue → now).
    const o2 = baseOpts({
      plan: (env, S, batch, base) => {
        const out: Effect[] = [...base()]
        for (const ev of batch) {
          if (ev.type !== 'flow.resumed') continue
          for (const [timerId, t] of Object.entries(S.timers)) {
            out.push({
              kind: 'timer.set',
              timerId,
              at: Math.max(t.at, env.now()),
              fire: { type: 'timer.fired', timerId },
            })
          }
        }
        return out
      },
    })
    o2.sched.advance(400) // 5_400: 600ms remain
    const resumed = resumeWizardRuntime(def, roundTrip(snap), o2)
    expect(o2.sched.pending()).toBe(1)
    o2.sched.advance(599)
    expect(resumed.getState().status).toBe('waiting')
    o2.sched.advance(1)
    expect(resumed.getState().status).toBe('done')
  })

  it('restores nested children from snapshot.children with their own instance ids', async () => {
    let resolveChild: (v: unknown) => void = () => {}
    const child = flow({
      name: 'child',
      steps: {
        t: {
          kind: 'task',
          hooks: { run: () => new Promise((r) => (resolveChild = r)) },
          next: { kind: 'static', targets: ['cend'] },
        },
        cend: { kind: 'final' },
      },
    })
    const parent = flow({
      name: 'parent',
      steps: {
        f: { kind: 'flow', child, next: { kind: 'static', targets: ['end'] } },
        end: { kind: 'final' },
      },
    })
    const o = baseOpts()
    const wizard = createWizardRuntime(parent, { ...o, context: {}, instanceId: 'p' })
    await wizard.start()
    const snap = wizard.getSnapshot()
    expect(snap.children.f?.state.status).toBe('running')
    const childId = wizard.child('f').id
    wizard.dispose()

    const resumed = resumeWizardRuntime(parent, roundTrip(snap), baseOpts())
    const c = resumed.child('f')
    expect(c.id).toBe(childId)
    expect(c.epoch).toBe(1)
    expect(c.getState().status).toBe('running')
    expect(resumed.getState().steps.f!.child).toMatchObject({ status: 'running' })
    void resolveChild
    // A broken child snapshot is atomic: nothing is instantiated.
    const broken = { ...snap, children: { f: { ...snap.children.f, v: 9 } } }
    expect(resumeErr(parent, broken).issues?.[0]?.message).toBe('children.f.v: expected 1, got 9')
  })

  it('an active flow step with no persisted child has its summary stripped so the machine re-creates it', async () => {
    // (The re-creation itself — plan(flow.resumed) → childContext → child.create — is proven
    // against the real machine in e2e-resume.test.ts; the toy machine only emits flow.resumed.)
    const child = flow({ name: 'child', steps: { w: { kind: 'wait', hooks: { on: {} } } } })
    const parent = flow({
      name: 'parent',
      steps: {
        f: { kind: 'flow', child, next: { kind: 'static', targets: ['end'] } },
        end: { kind: 'final' },
      },
    })
    const o = baseOpts()
    const wizard = createWizardRuntime(parent, { ...o, context: {}, instanceId: 'p' })
    await wizard.start()
    const snap = wizard.getSnapshot()
    expect(snap.state.steps.f!.child?.status).toBe('waiting')
    wizard.dispose()
    const reasons: string[] = []
    const plan = prepareResume(parent, roundTrip({ ...snap, children: {} }), '', reasons)
    expect(reasons).toEqual([])
    expect(plan?.state.steps.f?.child).toBeUndefined()
    expect(plan?.state.steps.f?.status).toBe('active')
    expect(plan?.children).toEqual({})
    // With the child persisted, the summary is kept and the child plan is prepared once.
    const full = prepareResume(parent, roundTrip(snap), '', reasons)
    expect(full?.state.steps.f?.child?.status).toBe('waiting')
    expect(Object.keys(full?.children ?? {})).toEqual(['f'])
    expect(full?.children.f?.state.epoch).toBe(1)
  })

  it('prepares the whole tree once and atomically: each boundary runs a single time and a broken child instantiates nothing', async () => {
    let contextParses = 0
    const child = flow({
      name: 'child',
      context: boundary((v) => {
        contextParses += 1
        return { ok: true, value: v }
      }),
      steps: { w: { kind: 'wait', hooks: { on: {} } } },
    })
    const parent = flow({
      name: 'parent',
      steps: {
        f: { kind: 'flow', child, next: { kind: 'static', targets: ['end'] } },
        end: { kind: 'final' },
      },
    })
    const o = baseOpts()
    const wizard = createWizardRuntime(parent, { ...o, context: {}, instanceId: 'p' })
    await wizard.start()
    const snap = wizard.getSnapshot()
    wizard.dispose()
    contextParses = 0
    const resumed = resumeWizardRuntime(parent, roundTrip(snap), baseOpts())
    expect(contextParses).toBe(1) // not re-run when the child is instantiated
    expect(resumed.child('f').getState().status).toBe('waiting')

    // A boundary that fails on the second call would leak a partially resumed root if
    // children were validated again after the root exists — they are not.
    let calls = 0
    const flaky = flow({
      name: 'child',
      context: boundary((v) => {
        calls += 1
        return calls === 1
          ? { ok: true, value: v }
          : { ok: false, issues: [{ message: 'second call' }] }
      }),
      steps: { w: { kind: 'wait', hooks: { on: {} } } },
    })
    const parent2 = {
      ...parent,
      steps: { ...parent.steps, f: { ...parent.steps.f!, child: flaky } },
    }
    const again = resumeWizardRuntime(parent2, roundTrip(snap), baseOpts())
    expect(calls).toBe(1)
    expect(again.child('f').getState().status).toBe('waiting')

    // Broken child snapshot: nothing is instantiated (no runtime, no `resume` message anywhere).
    const broken = {
      ...snap,
      children: {
        f: { ...snap.children.f, state: { ...snap.children.f!.state, status: 'bogus' } },
      },
    }
    expect(resumeErr(parent, broken).issues?.[0]?.message).toBe(
      "children.f.state.status: unknown status 'bogus'",
    )
  })

  it('a resumed root keeps persisting to the store', async () => {
    const store = createMemoryStore()
    const { snap } = await running()
    await store.set('k', snap)
    const o = baseOpts()
    const resumed = resumeWizardRuntime(twoViews, await store.get('k'), { ...o, store, key: 'k' })
    await resumed.next()
    await resumed.save()
    const saved = (await store.get('k')) as Snapshot
    expect(saved.epoch).toBe(1)
    expect(saved.state.status).toBe('done')
  })
})

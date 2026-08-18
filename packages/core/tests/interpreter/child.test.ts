import { describe, expect, it } from 'vitest'
import type { CompiledFlow } from '../../src/authoring/compiled'
import type { ChildFactory, ChildHandle } from '../../src/interpreter/child'
import { createSequentialIds } from '../../src/interpreter/env'
import {
  createInterpreter,
  type Interpreter,
  type InterpreterOptions,
} from '../../src/interpreter/interpreter'
import { createTestScheduler, type TestScheduler } from '../../src/interpreter/test-scheduler'
import type { Effect } from '../../src/machine/effects'
import type { DomainEvent } from '../../src/machine/events'
import type { WizardState } from '../../src/machine/state'
import { toSnapshot } from '../../src/wizard/snapshot'
import {
  createToyMachine,
  flow,
  initialState,
  type ToyOverrides,
  types,
} from '../helpers/fake-machine'

interface Handle extends ChildHandle {
  readonly interp: Interpreter<Handle>
}

/** A child handle backed directly by an interpreter (what the façade does, minus the sugar). */
function makeHandle(
  def: CompiledFlow,
  state: WizardState,
  path: readonly string[],
  sched: TestScheduler,
  ids: ReturnType<typeof createSequentialIds>,
  factory: ChildFactory<Handle>,
  overrides: ToyOverrides = {},
): Handle {
  const stateListeners = new Set<(s: WizardState) => void>()
  const eventListeners = new Set<(e: DomainEvent) => void>()
  const interp: Interpreter<Handle> = createInterpreter<Handle>({
    def,
    machine: createToyMachine(overrides),
    path,
    env: { clock: sched, scheduler: sched, ids },
    initialState: state,
    children: { factory },
    onEvent: (e) => {
      for (const l of eventListeners) l(e)
    },
    onCommit: (s) => {
      for (const l of stateListeners) l(s)
    },
  })
  return {
    interp,
    getState: () => interp.getState(),
    getSnapshot: () => toSnapshot(interp.getState(), interp.childSnapshots(), sched.now()),
    dispatch: async (cmd) => {
      interp.send(cmd)
    },
    subscribe: (l) => {
      stateListeners.add(l)
      return () => stateListeners.delete(l)
    },
    observe: (l) => {
      eventListeners.add(l)
      return () => eventListeners.delete(l)
    },
    dispose: () => interp.dispose(),
  }
}

function setup(
  parentDef: CompiledFlow,
  extra: Partial<InterpreterOptions<Handle>> = {},
  overrides: ToyOverrides = {},
) {
  const sched = createTestScheduler({ now: 500 })
  const ids = createSequentialIds()
  const env = { clock: sched, scheduler: sched, ids }
  const restored: string[] = []
  const factory: ChildFactory<Handle> = {
    create: (args) => {
      const menv = {
        def: args.def,
        path: args.path,
        now: () => sched.now(),
        id: (p: string) => ids.id(p),
      }
      const st = initialState(menv, {
        instanceId: ids.id('wiz'),
        context: args.context,
        now: sched.now(),
      })
      return makeHandle(args.def, st, args.path, sched, ids, factory)
    },
    restore: (args) => {
      restored.push(args.step)
      return makeHandle(args.def, args.plan.state, args.path, sched, ids, factory)
    },
  }
  const events: DomainEvent[] = []
  const menv = { def: parentDef, path: [], now: () => sched.now(), id: (p: string) => ids.id(p) }
  const interp = createInterpreter<Handle>({
    def: parentDef,
    machine: createToyMachine(overrides),
    path: [],
    env,
    initialState: initialState(menv, {
      instanceId: 'parent',
      context: { tenant: 'acme' },
      now: sched.now(),
    }),
    children: { factory, maxDepth: 3 },
    onEvent: (e) => events.push(e),
    ...extra,
  })
  return { interp, events, sched, ids, restored, factory }
}

const childDef = (run: () => unknown = () => 'child-out') =>
  flow({
    name: 'child',
    steps: {
      t: { kind: 'task', hooks: { run }, next: { kind: 'static', targets: ['cend'] } },
      cend: { kind: 'final' },
    },
  })

const parentDef = (child: CompiledFlow, extraSteps: Record<string, any> = {}) =>
  flow({
    name: 'parent',
    steps: {
      f: { kind: 'flow', child, next: { kind: 'static', targets: ['end'] }, ...extraSteps.f },
      end: { kind: 'final' },
    },
  })

describe('child bridge', () => {
  it('creates the child on child.create, starts it, forwards its events with path, and completes the flow step', () => {
    const child = childDef()
    const { interp, events } = setup(parentDef(child))
    interp.send({ type: 'start' })

    const childEvents = events.filter((e) => e.path.length === 1 && e.path[0] === 'f')
    expect(types(childEvents)).toEqual([
      'flow.started',
      'step.arrived',
      'step.entered',
      'step.runStarted',
      'step.runSucceeded',
      'step.done',
      'step.arrived',
      'step.entered',
      'step.done',
      'flow.done',
    ])
    // Child events are NOT in the parent's own log ring.
    expect(interp.log().every((e) => e.path.length === 0)).toBe(true)
    // The parent saw the summary and finished (toy: res.child{done} → step.done → final).
    expect(types(events.filter((e) => e.path.length === 0))).toContain('child.summary')
    const parent = interp.getState()
    expect(parent.steps.f!.status).toBe('done')
    expect(parent.steps.f!.child).toMatchObject({ status: 'done', progress: 1 })
    expect(parent.status).toBe('done')
    // Live handle + snapshot access.
    const handle = interp.child('f')
    expect(handle?.getState().status).toBe('done')
    expect(handle?.getState().context).toEqual({ tenant: 'acme' })
    expect(Object.keys(interp.childSnapshots())).toEqual(['f'])
    expect(interp.childSnapshots().f?.flow.name).toBe('child')
  })

  it('an async child keeps the parent running until its result flows back through res.child', async () => {
    let resolveRun: (v: unknown) => void = () => {}
    const child = childDef(() => new Promise((r) => (resolveRun = r)))
    const { interp } = setup(parentDef(child))
    interp.send({ type: 'start' })
    expect(interp.getState().status).toBe('running')
    expect(interp.getState().steps.f!.child?.status).toBe('running')
    resolveRun('late')
    await Promise.resolve()
    await Promise.resolve()
    expect(interp.child('f')?.getState().status).toBe('done')
    expect(interp.getState().steps.f!.status).toBe('done')
    expect(interp.getState().status).toBe('done')
  })

  it('sends done/failed flags only on the transition into that status', () => {
    const child = childDef()
    const summaries: Array<{ done: boolean; failed: boolean }> = []
    const { interp } = setup(
      parentDef(child),
      {},
      {
        decide: (_e, _s, msg, base) => {
          if (msg.type === 'res.child')
            summaries.push({ done: msg.done !== undefined, failed: msg.failed !== undefined })
          return base()
        },
      },
    )
    interp.send({ type: 'start' })
    // Poke the (terminal) child again: it commits a command.rejected batch → summary without `done`.
    interp.child('f')?.dispatch({ type: 'start' })
    expect(summaries.filter((s) => s.done)).toHaveLength(1)
    expect(summaries.at(-1)).toEqual({ done: false, failed: false })
  })

  it('a failed child fails the flow step (kind child)', () => {
    const child = childDef(() => {
      throw new Error('child exploded')
    })
    const { interp } = setup(parentDef(child))
    interp.send({ type: 'start' })
    expect(interp.child('f')?.getState().status).toBe('failed')
    expect(interp.getState().steps.f!.status).toBe('failed')
    expect(interp.getState().steps.f!.error).toMatchObject({
      kind: 'child',
      message: 'child exploded',
    })
    expect(interp.getState().status).toBe('failed')
  })

  it('routes child.send effects to the child and honours child.dispose', () => {
    const child = flow({
      name: 'child',
      steps: {
        w: {
          kind: 'wait',
          hooks: { on: { ping: ({ payload }: any) => ({ done: { got: payload } }) } },
          next: { kind: 'static', targets: ['cend'] },
        },
        cend: { kind: 'final' },
      },
    })
    const { interp } = setup(
      parentDef(child),
      {},
      {
        plan: (_e, _s, batch, base) => {
          const out: Effect[] = [...base()]
          for (const ev of batch) {
            if (ev.type === 'context.changed') {
              out.push({
                kind: 'child.send',
                step: 'f',
                command: { type: 'send', event: 'ping', payload: 'hi' },
              })
            }
            if (ev.type === 'input.changed') out.push({ kind: 'child.dispose', step: 'f' })
          }
          return out
        },
      },
    )
    interp.send({ type: 'start' })
    expect(interp.child('f')?.getState().status).toBe('waiting')
    interp.send({ type: 'context.patch', patch: { go: 1 } })
    expect(interp.child('f')?.getState().steps.w?.output).toEqual({ got: 'hi' })
    expect(interp.getState().status).toBe('done')
    interp.send({ type: 'reset' }) // toy: flow.reset → interpreter disposes children
    expect(interp.child('f')).toBeUndefined()
  })

  it('guards nesting depth and ancestor cycles by failing the flow step', () => {
    const child = childDef()
    const deep = parentDef(child)
    // maxDepth 0: any child is too deep.
    const a = setup(deep, { children: { factory: setup(deep).factory, maxDepth: 0 } })
    a.interp.send({ type: 'start' })
    expect(a.interp.getState().steps.f!.error).toMatchObject({
      kind: 'child',
      code: 'NESTING_TOO_DEEP',
    })

    // A flow that embeds itself: identity of the child === identity of the parent.
    const selfDef = parentDef(child)
    const cyclic = {
      ...selfDef,
      steps: { ...selfDef.steps, f: { ...selfDef.steps.f!, child: selfDef } },
    }
    const b = setup(cyclic)
    b.interp.send({ type: 'start' })
    expect(b.interp.getState().steps.f!.error).toMatchObject({
      kind: 'child',
      code: 'NESTING_CYCLE',
    })
  })

  it('restoreChild re-attaches a child from its snapshot and reports its summary', () => {
    const child = childDef(() => new Promise(() => {}))
    const first = setup(parentDef(child))
    first.interp.send({ type: 'start' })
    const childSnap = first.interp.childSnapshots().f!
    expect(childSnap.state.status).toBe('running')

    const second = setup(parentDef(child))
    second.interp.send({ type: 'start' }) // creates a fresh child; restore replaces it
    second.interp.restoreChild('f', childSnap)
    expect(second.restored).toEqual(['f'])
    expect(second.interp.child('f')?.getState().instanceId).toBe(childSnap.instanceId)
    const summaries = second.events.filter((e) => e.type === 'child.summary')
    expect(summaries.at(-1)).toMatchObject({
      type: 'child.summary',
      summary: { status: 'running', seq: childSnap.seq },
    })
  })

  it('dispose() disposes children too', () => {
    const child = childDef(() => new Promise(() => {}))
    const { interp } = setup(parentDef(child))
    interp.send({ type: 'start' })
    const handle = interp.child('f')!
    interp.dispose()
    expect(handle.interp.isDisposed()).toBe(true)
  })

  it('without a child factory the flow step fails with CHILD_UNSUPPORTED', () => {
    const child = childDef()
    const sched = createTestScheduler()
    const ids = createSequentialIds()
    const def = parentDef(child)
    const menv = { def, path: [], now: () => sched.now(), id: (p: string) => ids.id(p) }
    const interp = createInterpreter({
      def,
      machine: createToyMachine(),
      path: [],
      env: { clock: sched, scheduler: sched, ids },
      initialState: initialState(menv, { instanceId: 'p', context: {}, now: 0 }),
    })
    interp.send({ type: 'start' })
    expect(interp.getState().steps.f!.error).toMatchObject({
      kind: 'child',
      code: 'CHILD_UNSUPPORTED',
    })
  })
})

import { describe, expect, it } from 'vitest'
import type { HookArgs } from '../../src/authoring/compiled'
import type {
  ChildCreateArgs,
  ChildFactory,
  ChildHandle,
  ChildRestoreArgs,
} from '../../src/interpreter/child-types'
import {
  createEachChildBridge,
  eachChildAddress,
  parseEachChildAddress,
} from '../../src/interpreter/each-child'
import type { Command, Message } from '../../src/machine/commands'
import { createEachState, eachOutputs, updateEachItem } from '../../src/machine/each-state'
import type { DomainEvent } from '../../src/machine/events'
import type { WizardState } from '../../src/machine/state'
import { type Snapshot, toSnapshot } from '../../src/wizard/snapshot'
import { flow, initialState, trusted } from '../helpers/fake-machine'

interface Handle extends ChildHandle {
  readonly commands: Command[]
  readonly resumed: { count: number }
  readonly disposed: { value: boolean }
  commit(patch: Partial<WizardState>): void
  emit(event: DomainEvent): void
}

function stateFor(def: ReturnType<typeof flow>, context: unknown): WizardState {
  return initialState(
    { def, path: [], now: () => 10, id: () => 'id' },
    { instanceId: 'instance', context, now: 10 },
  )
}

function handleFor(snapshot: Snapshot, passive = false): Handle {
  let state = snapshot.state
  const subscribers = new Set<(state: WizardState) => void>()
  const observers = new Set<(event: DomainEvent) => void>()
  const commands: Command[] = []
  const resumed = { count: 0 }
  const disposed = { value: false }
  const commit = (patch: Partial<WizardState>): void => {
    state = { ...state, ...patch }
    for (const subscriber of subscribers) subscriber(state)
  }
  return {
    commands,
    resumed,
    disposed,
    commit,
    emit: (event) => {
      for (const observer of observers) observer(event)
    },
    getState: () => state,
    getSnapshot: () => toSnapshot(state, snapshot.children, 10),
    dispatch: async (command) => {
      commands.push(command)
    },
    subscribe: (subscriber) => {
      subscribers.add(subscriber)
      return () => subscribers.delete(subscriber)
    },
    observe: (observer) => {
      observers.add(observer)
      return () => observers.delete(observer)
    },
    ...(passive
      ? {
          resumePrepared() {
            resumed.count++
            if (state.status !== 'done') commit({ seq: state.seq + 1, status: 'running' })
          },
        }
      : {}),
    dispose: () => {
      disposed.value = true
    },
  }
}

function setup(keys = ['one', 'two'], extraSteps: Parameters<typeof flow>[0]['steps'] = {}) {
  const items = keys.map((key) => ({ key }))
  const mappedArgs: HookArgs[] = []
  let boundaryCalls = 0
  const child = flow({
    name: 'child',
    steps: { work: { kind: 'step', hooks: { run: () => 1 } } },
  })
  const childWithDeps = {
    ...child,
    deps: {
      ...trusted,
      parse(value: unknown) {
        boundaryCalls++
        return { ok: true as const, value }
      },
    },
  }
  const def = flow({
    name: 'parent',
    steps: {
      mapped: {
        kind: 'flow',
        child: childWithDeps,
        each: { items: () => items, concurrency: 2 },
        hooks: {
          childDeps(args) {
            mappedArgs.push(args)
            return { ...Object(args.deps), item: args.item, index: args.index }
          },
        },
      },
      plain: { kind: 'flow', child },
      ...extraSteps,
    },
  })
  const initial = stateFor(def, { tenant: 'acme' })
  let each = createEachState(items, keys)
  for (let index = 0; index < items.length; index++)
    each = updateEachItem(each, index, { status: 'running', attempt: index + 1 })
  let state: WizardState = {
    ...initial,
    status: 'running',
    steps: {
      ...initial.steps,
      mapped: { ...initial.steps.mapped!, status: 'active', runId: 7, each },
    },
  }
  const created: ChildCreateArgs[] = []
  const restored: ChildRestoreArgs<Snapshot>[] = []
  const handles: Handle[] = []
  const factory: ChildFactory<Handle> = {
    create(args) {
      created.push(args)
      const handle = handleFor(toSnapshot(stateFor(args.def, args.context), {}, 10))
      handles.push(handle)
      return handle
    },
    restore(args) {
      restored.push(args)
      const handle = handleFor(args.plan, true)
      handles.push(handle)
      return handle
    },
  }
  const messages: Message[] = []
  const forwarded: DomainEvent[] = []
  const bridge = createEachChildBridge({
    def,
    path: [],
    ancestors: [],
    factory,
    deps: { service: 'parent-service' },
    getState: () => state,
    hookArgs(step) {
      return {
        step,
        path: [],
        context: state.context,
        deps: { service: 'parent-service' },
        input: undefined,
        output: undefined,
        needs: { loaded: 'owner-needs' },
        signal: new AbortController().signal,
        attempt: state.steps[step]?.attempt ?? 0,
        runId: state.steps[step]?.runId ?? 0,
        idempotencyKey: `parent:${step}`,
        update: () => {},
        progress: () => {},
      }
    },
    send: (message) => messages.push(message),
    forward: (event) => forwarded.push(event),
    turn: { busy: () => false, defer: (resume) => resume() },
  })
  return {
    bridge,
    def,
    created,
    restored,
    handles,
    messages,
    forwarded,
    mappedArgs,
    boundaryCalls: () => boundaryCalls,
    getState: () => state,
    setState(next: WizardState) {
      state = next
    },
  }
}

describe('indexed child addresses', () => {
  it('roundtrips keys with slashes, percent escapes, unicode, and empty keys', () => {
    for (const key of ['a/b', '%', '東京', '', '__proto__']) {
      const address = eachChildAddress('orders/fulfil', 12, key)
      expect(parseEachChildAddress(address)).toEqual({ step: 'orders/fulfil', index: 12, key })
    }
  })

  it('rejects malformed escapes, noncanonical indices, and extra path segments', () => {
    for (const address of [
      '@each/x/-1/k',
      '@each/x/01/k',
      '@each/x/1.5/k',
      '@each/x/9007199254740992/k',
      '@each/%/0/k',
      '@each/x/0/%',
      '@each/x/0/k/more',
    ])
      expect(parseEachChildAddress(address)).toBeUndefined()
  })

  it('avoids literal step ids without changing the indexed identity', () => {
    const occupied = { '@each/mapped/0/one': {}, '@@each/mapped/0/one': {} }
    const address = eachChildAddress('mapped', 0, 'one', occupied)
    expect(address).toBe('@@@each/mapped/0/one')
    expect(parseEachChildAddress(address)).toEqual({ step: 'mapped', index: 0, key: 'one' })
  })
})

describe('map child bridge', () => {
  it('creates distinct children and passes owner hook args, item, and index to deps mappers', () => {
    const s = setup(['one/a', 'two'])
    s.bridge.create('mapped', { order: 'first' }, 3, 0)
    s.bridge.create('mapped', { order: 'second' }, 3, 1)
    expect(s.created.map((args) => args.path)).toEqual([
      [eachChildAddress('mapped', 0, 'one/a')],
      [eachChildAddress('mapped', 1, 'two')],
    ])
    expect(s.created.map((args) => args.context)).toEqual([{ order: 'first' }, { order: 'second' }])
    expect(s.created.map((args) => args.deps)).toEqual([
      { service: 'parent-service', item: { key: 'one/a' }, index: 0 },
      { service: 'parent-service', item: { key: 'two' }, index: 1 },
    ])
    expect(s.mappedArgs.map((args) => [args.step, args.needs])).toEqual([
      ['mapped', { loaded: 'owner-needs' }],
      ['mapped', { loaded: 'owner-needs' }],
    ])
    expect(s.boundaryCalls()).toBe(2)
    expect(s.handles.map((handle) => handle.commands)).toEqual([
      [{ type: 'start' }],
      [{ type: 'start' }],
    ])
  })

  it('captures independent item attempts and keeps finished child snapshots', () => {
    const s = setup()
    s.bridge.create('mapped', {}, undefined, 0)
    s.bridge.create('mapped', {}, undefined, 1)
    const before = s.getState()
    const each = updateEachItem(before.steps.mapped!.each!, 0, { attempt: 9, generation: 9 })
    s.setState({ ...before, steps: { ...before.steps, mapped: { ...before.steps.mapped!, each } } })
    s.handles[1]!.commit({ status: 'done', output: 'second-output', seq: 2 })
    s.handles[0]!.commit({ status: 'done', output: 'first-output', seq: 3 })
    expect(s.messages).toMatchObject([
      {
        step: 'mapped',
        token: { step: 'mapped', runId: 7, itemIndex: 1, itemGeneration: 0, attempt: 2 },
        done: { output: 'second-output' },
      },
      {
        step: 'mapped',
        token: { step: 'mapped', runId: 7, itemIndex: 0, itemGeneration: 0, attempt: 1 },
        done: { output: 'first-output' },
      },
    ])
    const snapshots = s.bridge.snapshots()
    expect(snapshots[eachChildAddress('mapped', 0, 'one')]?.state.output).toBe('first-output')
    expect(snapshots[eachChildAddress('mapped', 1, 'two')]?.state.output).toBe('second-output')
  })

  it('forwards item paths, addresses one child, and cancels or disposes every item by owner', () => {
    const s = setup()
    s.bridge.create('mapped', {}, undefined, 0)
    s.bridge.create('mapped', {}, undefined, 1)
    const first = eachChildAddress('mapped', 0, 'one')
    const event: DomainEvent = {
      type: 'flow.started',
      start: 'work',
      at: 10,
      seq: 1,
      path: [first],
    }
    s.handles[0]!.emit(event)
    expect(s.forwarded).toEqual([{ ...event, path: ['mapped', '0'] }])
    expect(event.path).toEqual([first])
    s.bridge.send(first, { type: 'send', event: 'ping', payload: 1 })
    expect(s.handles[0]!.commands).toHaveLength(2)
    expect(s.handles[1]!.commands).toHaveLength(1)
    s.bridge.send('mapped', { type: 'cancel' })
    expect(s.handles.every((handle) => handle.commands.at(-1)?.type === 'cancel')).toBe(true)
    expect(s.bridge.get(first)).toBe(s.handles[0])
    s.bridge.dispose('mapped')
    expect(s.handles.every((handle) => handle.disposed.value)).toBe(true)
    expect(s.bridge.snapshots()).toEqual({})
    expect(s.bridge.has('mapped')).toBe(false)
  })

  it('reports a lost item with its token and a summary newer than its persisted child', () => {
    const s = setup(['one'])
    s.bridge.create('mapped', {}, undefined, 0)
    const before = s.getState()
    const each = updateEachItem(before.steps.mapped!.each!, 0, {
      child: { status: 'running', current: null, progress: 0, seq: 42 },
    })
    s.setState({ ...before, steps: { ...before.steps, mapped: { ...before.steps.mapped!, each } } })
    s.created[0]!.parent.stopped(new Error('child worker stopped'))
    expect(s.messages.at(-1)).toMatchObject({
      type: 'res.child',
      step: 'mapped',
      token: { step: 'mapped', runId: 7, itemIndex: 0, attempt: 1 },
      summary: { status: 'failed', seq: 43 },
      failed: { error: { message: 'child worker stopped' } },
    })
    expect(s.bridge.has('mapped')).toBe(false)
    expect(s.bridge.snapshots()).toEqual({})
  })

  it('selects children by exact stable key or numeric index and rejects invalid selectors', () => {
    const s = setup(['1', 'zero/a', 'named'])
    s.bridge.create('mapped', {}, undefined, 0)
    s.bridge.create('mapped', {}, undefined, 1)
    expect(s.bridge.get('mapped', 0)).toBe(s.handles[0])
    expect(s.bridge.get('mapped', '1')).toBe(s.handles[0])
    expect(s.bridge.get('mapped', 1)).toBe(s.handles[1])
    expect(s.bridge.get('mapped', 'zero/a')).toBe(s.handles[1])
    expect(s.bridge.get('mapped', 'named')).toBeUndefined()
    expect(s.bridge.get('mapped')).toBeUndefined()
    for (const selector of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 3, 'missing'])
      expect(s.bridge.get('mapped', selector)).toBeUndefined()
    s.bridge.create('plain', {})
    expect(s.bridge.get('plain', 0)).toBeUndefined()
    expect(s.bridge.get('plain')).toBe(s.handles[2])
    s.bridge.dispose('mapped')
    expect(s.bridge.get('mapped', '1')).toBeUndefined()
  })

  it('attaches restored completed items before resuming unfinished children without restarting them', () => {
    const s = setup()
    const before = s.getState()
    let each = updateEachItem(before.steps.mapped!.each!, 0, {
      status: 'done',
      output: 'finished',
      child: { status: 'done', current: null, progress: 1, seq: 5 },
    })
    each = updateEachItem(each, 1, {
      child: { status: 'running', current: null, progress: 0, seq: 2 },
    })
    s.setState({ ...before, steps: { ...before.steps, mapped: { ...before.steps.mapped!, each } } })
    const child = s.def.steps.mapped!.child!
    const finished = toSnapshot(
      { ...stateFor(child, {}), status: 'done', output: 'finished', seq: 5 },
      {},
      10,
    )
    const running = toSnapshot({ ...stateFor(child, {}), status: 'running', seq: 2 }, {}, 10)
    s.bridge.restore(eachChildAddress('mapped', 0, 'one'), finished)
    s.bridge.restore(eachChildAddress('mapped', 1, 'two'), running)
    expect(s.messages).toEqual([])
    expect(Object.keys(s.bridge.snapshots())).toHaveLength(2)
    s.bridge.resumeRestored()
    expect(s.handles.map((handle) => handle.commands)).toEqual([[], []])
    expect(s.handles.map((handle) => handle.resumed.count)).toEqual([1, 1])
    expect(eachOutputs(s.getState().steps.mapped!.each!)).toEqual(['finished', undefined])
    expect(s.messages).toHaveLength(1)
    expect(s.messages[0]).toMatchObject({ step: 'mapped', token: { itemIndex: 1, attempt: 2 } })
  })

  it('keeps ordinary child flows and indexed children with colliding literal ids separate', () => {
    const collision = eachChildAddress('mapped', 0, 'one')
    const child = flow({ steps: { end: { kind: 'step', hooks: { run: () => 1 } } } })
    const s = setup(['one'], { [collision]: { kind: 'flow', child } })
    s.bridge.create(collision, { plain: true })
    s.bridge.create('mapped', { mapped: true }, undefined, 0)
    expect(s.bridge.get(collision)).toBe(s.handles[0])
    const indexed = eachChildAddress('mapped', 0, 'one', s.def.steps)
    expect(s.bridge.get(indexed)).toBe(s.handles[1])
    expect(Object.keys(s.bridge.snapshots())).toEqual([collision, indexed])
    s.bridge.dispose(indexed)
    expect(s.handles[0]!.disposed.value).toBe(false)
    expect(s.handles[1]!.disposed.value).toBe(true)
  })
})

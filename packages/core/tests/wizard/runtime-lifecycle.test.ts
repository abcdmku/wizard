/**
 * Run runtime — subscriptions and snapshots, nested flows, dispose, and the sync-commit guarantee for `send()`.
 */
import { describe, expect, it } from 'vitest'
import type { CompiledFlow } from '../../src/authoring/compiled'
import { WizardError } from '../../src/errors'
import { createSequentialIds } from '../../src/interpreter/env'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import type { DomainEvent } from '../../src/machine/events'
import type { WizardState } from '../../src/machine/state'
import { createWizardRuntime, type WizardRuntimeOptions } from '../../src/wizard/runtime'
import {
  createToyMachine,
  flow,
  initialState,
  stringsBoundary,
  type ToyOverrides,
  types,
} from '../helpers/fake-machine'

function make(
  def: CompiledFlow,
  opts: Partial<WizardRuntimeOptions> = {},
  overrides: ToyOverrides = {},
) {
  const sched = createTestScheduler({ now: 1_000 })
  const run = createWizardRuntime(def, {
    context: { tenant: 't1' },
    machine: createToyMachine(overrides),
    initialState,
    scheduler: sched,
    ids: createSequentialIds(),
    instanceId: 'wiz-1',
    ...opts,
  })
  const events: DomainEvent[] = []
  const states: WizardState[] = []
  run.observe((e) => events.push(e))
  run.subscribe((s) => states.push(s))
  return { run, sched, events, states }
}

const twoViews = (extra: Record<string, any> = {}) =>
  flow({
    steps: {
      a: { kind: 'view', next: { kind: 'static', targets: ['b'] }, ...extra.a },
      b: { kind: 'view', next: { kind: 'static', targets: ['end'] }, ...extra.b },
      end: { kind: 'step' },
    },
  })

describe('run runtime: subscriptions and snapshots', () => {
  it('subscribe fires once per commit, observe streams events, unsubscribe stops both', async () => {
    const { run } = make(twoViews())
    const seen: number[] = []
    const evs: string[] = []
    const off1 = run.subscribe((s) => seen.push(s.seq))
    const off2 = run.observe((e) => evs.push(e.type))
    await run.start()
    expect(seen).toEqual([3])
    expect(evs).toEqual(['flow.started', 'step.arrived', 'step.entered'])
    off1()
    off2()
    await run.next()
    expect(seen).toEqual([3])
    expect(evs).toHaveLength(3)
  })

  it('getSnapshot() is cached per state and carries the envelope', async () => {
    const { run, sched } = make(twoViews())
    const s0 = run.getSnapshot()
    expect(s0).toMatchObject({
      v: 1,
      flow: { name: 'test-flow', version: 1 },
      instanceId: 'wiz-1',
      epoch: 0,
      seq: 0,
      savedAt: 1_000,
    })
    expect(run.getSnapshot()).toBe(s0)
    sched.advance(10)
    expect(run.getSnapshot()).toBe(s0)
    await run.start()
    const s1 = run.getSnapshot()
    expect(s1).not.toBe(s0)
    expect(s1.seq).toBe(3)
    expect(s1.state).toBe(run.getState())
    expect(s1.children).toEqual({})
    expect(run.log().map((e) => e.seq)).toEqual([1, 2, 3])
  })
})

describe('run runtime: nested flows', () => {
  const child = flow({
    name: 'child',
    steps: {
      t: {
        kind: 'step',
        hooks: { run: ({ context }: any) => ({ echo: context }) },
        next: { kind: 'static', targets: ['cend'] },
      },
      cend: { kind: 'step' },
    },
  })
  const parent = flow({
    name: 'parent',
    steps: {
      f: { kind: 'flow', child, next: { kind: 'static', targets: ['end'] } },
      end: { kind: 'step' },
    },
  })

  it('child(step) throws for non-flow steps and before creation; afterwards returns the runtime', async () => {
    const { run, events } = make(parent)
    expect(() => run.child('end')).toThrow(WizardError)
    expect(() => run.child('f')).toThrowError(/not been created/)
    await run.start()
    const c = run.child('f')
    expect(c.path).toEqual(['f'])
    expect(c.getState().status).toBe('done')
    expect(c.getState().steps.t!.output).toEqual({ echo: { tenant: 't1' } })
    expect(run.getState().status).toBe('done')
    expect(events.filter((e) => e.path[0] === 'f').length).toBeGreaterThan(0)
    expect(run.getSnapshot().children.f?.instanceId).toBe(c.id)
  })

  it('after dispose: child() returns the disposed child, attach() never calls its source, listeners are inert', async () => {
    const { run } = make(parent)
    await run.start()
    const live = run.child('f')
    run.dispose()
    expect(run.child('f')).toBe(live)
    expect(await live.start()).toEqual({
      ok: false,
      code: 'DISPOSED',
      message: 'the run is disposed; create or resume a new run',
    })
    let called = false
    const detach = run.attach(() => {
      called = true
      return () => {}
    })
    detach()
    expect(called).toBe(false)
    expect(run.observe(() => {})).toBeTypeOf('function')
  })

  it('dispatch({ type: "child" }) goes through the parent FIFO: the parent machine gates it and plans child.send', async () => {
    const asyncChild = flow({
      name: 'child',
      steps: {
        w: {
          kind: 'step',
          hooks: { waitFor: { ping: () => ({ done: 'pinged' }) } },
          next: { kind: 'static', targets: ['cend'] },
        },
        cend: { kind: 'step' },
      },
    })
    const p = flow({
      name: 'parent',
      events: { ping: stringsBoundary('id') },
      steps: {
        f: { kind: 'flow', child: asyncChild, next: { kind: 'static', targets: ['end'] } },
        end: { kind: 'step' },
      },
    })
    const { run, events } = make(p)
    // Not started yet: the toy machine rejects (terminal/idle gates live in the parent machine).
    expect(
      await run.dispatch({ type: 'child', path: ['end'], command: { type: 'startReady' } }),
    ).toMatchObject({ ok: false, code: 'NOT_A_FLOW_STEP' })
    expect(
      await run.dispatch({ type: 'child', path: ['f'], command: { type: 'startReady' } }),
    ).toMatchObject({ ok: false, code: 'NOT_ACTIVE' })
    await run.start()
    const seqBefore = run.getState().seq
    // Accepted: one parent event (child.command) → the promise resolves with the PARENT seq;
    // the child receives the command through the bridge (child.send) inside the same drain.
    const r = await run.dispatch({
      type: 'child',
      path: ['f'],
      command: { type: 'setInput', step: 'w', patch: {} },
    })
    expect(r).toEqual({ ok: true, seq: seqBefore + 1 })
    expect(events.find((e) => e.path.length === 0 && e.type === 'child.command')).toMatchObject({
      type: 'child.command',
      step: 'f',
      command: { type: 'setInput', step: 'w', patch: {} },
    })
    // The child logged the (rejected) command itself → observable through path ['f'].
    expect(events.find((e) => e.path[0] === 'f' && e.type === 'command.rejected')).toMatchObject({
      command: { type: 'setInput', step: 'w' },
    })
    // Nested path: the parent forwards `{ type: 'child', path: rest, command }` down the chain (toy: 1 level).
    // A `send` addressed to the child runs the CHILD's boundary/routing (child.send → child.dispatch).
    const before = run.child('f').getState().seq
    await run.dispatch({
      type: 'child',
      path: ['f'],
      command: { type: 'send', event: 'ping', payload: { id: 'x' } },
    })
    // The child flow declares no events → its dispatch answers UNKNOWN_EVENT (no state change).
    expect(run.child('f').getState().seq).toBe(before)
    expect(run.child('f').getState().status).toBe('waiting')
  })
})

describe('run runtime: dispose', () => {
  it('rejects further calls with DISPOSED and settles pending navigation promises', async () => {
    const def = twoViews({ a: { hooks: { canExit: () => new Promise(() => {}) } } })
    const { run } = make(def)
    await run.start()
    const pending = run.next()
    run.dispose()
    expect(run.isDisposed()).toBe(true)
    const disposedNav = {
      ok: false,
      reason: 'failed',
      code: 'DISPOSED',
      message: 'the run is disposed; create or resume a new run',
    }
    expect(await pending).toEqual(disposedNav)
    // After dispose every command resolves a DISPOSED value; subscriptions are inert.
    expect(await run.next()).toEqual(disposedNav)
    expect(await run.dispatch({ type: 'start' })).toEqual({
      ok: false,
      code: 'DISPOSED',
      message: 'the run is disposed; create or resume a new run',
    })
    expect(run.subscribe(() => {})).toBeTypeOf('function')
    // Reads still work for post-mortem.
    expect(run.getState().current).toBe('a')
    run.dispose() // idempotent
  })

  it("strict: 'sync' is honoured", async () => {
    const def = flow({
      steps: {
        t: {
          kind: 'step',
          hooks: { run: async () => 1 },
          next: { kind: 'static', targets: ['end'] },
        },
        end: { kind: 'step' },
      },
    })
    const { run } = make(def, { strict: 'sync' })
    await run.start()
    expect(run.getState().steps.t!.error?.kind).toBe('sync-violation')
  })

  it('settles a send() waiting on an async event boundary and a validate() waiting on an async hook', async () => {
    let releaseBoundary: (r: any) => void = () => {}
    let signal: AbortSignal | undefined
    const def = flow({
      events: { slow: { kind: 'parse', parse: () => new Promise((r) => (releaseBoundary = r)) } },
      steps: {
        a: {
          kind: 'view',
          hooks: {
            validate: (args: any) => {
              signal = args.signal
              return new Promise(() => {})
            },
          },
        },
      },
    })
    const { run } = make(def)
    await run.start()
    const sending = run.send('slow', { id: 1 })
    const validating = run.validate('a')
    run.dispose()
    expect(await sending).toEqual({
      ok: false,
      reason: 'dropped',
      code: 'DISPOSED',
      message: 'the run is disposed; create or resume a new run',
    })
    expect(await validating).toEqual([
      { message: 'the run is disposed; create or resume a new run' },
    ])
    expect(signal?.aborted).toBe(true)
    // The abandoned boundary settling later is harmless (handlers attached; nothing enqueued).
    releaseBoundary({ ok: true, value: {} })
    await Promise.resolve()
    await Promise.resolve()
    expect(run.log().some((e) => e.type === 'event.received')).toBe(false)
  })
})

describe('run runtime: sync-commit guarantee for send()', () => {
  it('a sync boundary enqueues before send() returns and the promise is already fulfilled', async () => {
    const def = flow({
      events: { ping: stringsBoundary('id') },
      steps: {
        w: {
          kind: 'step',
          hooks: { waitFor: { ping: () => ({ done: 'ok' }) } },
          next: { kind: 'static', targets: ['end'] },
        },
        end: { kind: 'step' },
      },
    })
    const { run, events } = make(def)
    await run.start()
    // A rejected boundary: sendRejected is enqueued synchronously and the promise is fulfilled.
    const p2 = run.send('ping', { id: 2 })
    expect(types(events)).toContain('event.rejected')
    let fulfilled2 = false
    void p2.then(() => {
      fulfilled2 = true
    })
    await Promise.resolve()
    expect(fulfilled2).toBe(true)
    // A passing boundary: committed before the call returned — routing AND the sync handler ran.
    const p = run.send('ping', { id: 'p1' })
    expect(types(events)).toContain('event.delivered')
    expect(run.getState().status).toBe('done')
    let fulfilled = false
    void p.then(() => {
      fulfilled = true
    })
    await Promise.resolve()
    expect(fulfilled).toBe(true)
  })

  it('every sync command promise is already fulfilled when returned (start/next/setInput/dispatch)', async () => {
    const { run } = make(twoViews())
    const checks: Array<Promise<unknown>> = [run.start()]
    checks.push(run.setInput('a', { x: 1 }), run.next(), run.dispatch({ type: 'go', step: 'a' }))
    const settled = checks.map(() => false)
    checks.forEach((p, i) => {
      void p.then(() => {
        settled[i] = true
      })
    })
    await Promise.resolve()
    expect(settled).toEqual([true, true, true, true])
    expect(run.getState().current).toBe('a')
  })

  it("preserves a hook error's WizardError code (SYNC_VIOLATION) through NavResult and CommandResult", async () => {
    const def = twoViews({ a: { hooks: { canExit: async () => true } } })
    const { run } = make(def, { strict: 'sync' })
    await run.start()
    const nav = await run.next()
    expect(nav).toMatchObject({ ok: false, reason: 'failed', code: 'SYNC_VIOLATION', step: 'a' })
    expect(await run.dispatch({ type: 'next' })).toMatchObject({
      ok: false,
      code: 'SYNC_VIOLATION',
      step: 'a',
    })
  })
})

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
  const wizard = createWizardRuntime(def, {
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
  wizard.observe((e) => events.push(e))
  wizard.subscribe((s) => states.push(s))
  return { wizard, sched, events, states }
}

const twoViews = (extra: Record<string, any> = {}) =>
  flow({
    steps: {
      a: { kind: 'view', next: { kind: 'static', targets: ['b'] }, ...extra.a },
      b: { kind: 'view', next: { kind: 'static', targets: ['end'] }, ...extra.b },
      end: { kind: 'final' },
    },
  })

describe('wizard runtime: identity and options', () => {
  it('exposes id, path and epoch; a TestScheduler doubles as the clock', async () => {
    const { wizard, sched, events } = make(twoViews())
    expect(wizard.id).toBe('wiz-1')
    expect(wizard.path).toEqual([])
    expect(wizard.epoch).toBe(0)
    sched.advance(25)
    await wizard.start()
    expect(events[0]?.at).toBe(1_025)
  })

  it('start() resolves { ok, seq } and a second start is a rejected command', async () => {
    const { wizard, states } = make(twoViews())
    const r1 = await wizard.start()
    expect(r1).toEqual({ ok: true, seq: 3 })
    expect(states).toHaveLength(1)
    const r2 = await wizard.start()
    expect(r2).toEqual({ ok: false, code: 'INVALID_COMMAND', message: 'already started' })
  })
})

describe('wizard runtime: dispatch result mapping', () => {
  it('maps command.rejected to { ok: false, code, message, step }', async () => {
    const { wizard } = make(twoViews())
    await wizard.start()
    const r = await wizard.retry('a')
    expect(r).toEqual({ ok: false, code: 'NOT_A_TASK', message: 'not a failed task', step: 'a' })
    // Unknown codes degrade to INVALID_COMMAND.
    const custom = make(
      twoViews(),
      {},
      {
        decide: (_e, _s, msg) =>
          msg.type === 'runReady'
            ? [{ type: 'command.rejected', command: msg, reason: 'nope', code: 'WHATEVER' }]
            : undefined,
      },
    )
    await custom.wizard.start()
    expect(await custom.wizard.runReady()).toEqual({
      ok: false,
      code: 'INVALID_COMMAND',
      message: 'nope',
    })
  })

  it('a message the machine ignores resolves { ok: true } with the current seq', async () => {
    const { wizard } = make(twoViews())
    await wizard.start()
    expect(await wizard.runReady()).toEqual({ ok: true, seq: 3 })
    expect(await wizard.compensate({ reason: 'x' })).toEqual({ ok: true, seq: 3 })
  })

  it('validates wire shapes: invalid input never throws', async () => {
    const { wizard } = make(twoViews())
    const r = await wizard.dispatch({ type: 'go' } as any)
    expect(r).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })
    expect((r as any).issues[0]).toMatchObject({ path: ['step'] })
    const r2 = await wizard.dispatch('nonsense' as any)
    expect(r2).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })
  })

  it('setInput/resetInput/cancel are plain command results', async () => {
    const { wizard } = make(twoViews())
    await wizard.start()
    expect(await wizard.setInput('a', { name: 'x' })).toEqual({ ok: true, seq: 4 })
    expect(wizard.getState().steps.a!.input).toEqual({ name: 'x' })
    expect(await wizard.setInput('end', {})).toMatchObject({ ok: false, code: 'NOT_A_VIEW' })
    expect(await wizard.cancel('bye')).toEqual({ ok: true, seq: 7 })
    expect(wizard.getState().status).toBe('cancelled')
    expect(await wizard.next()).toMatchObject({
      ok: false,
      reason: 'flow-terminal',
      code: 'FLOW_TERMINAL',
    })
  })
})

describe('wizard runtime: navigation promises', () => {
  it('a fully synchronous next() commits before the promise is awaited and resolves via the batch', async () => {
    const { wizard, events } = make(twoViews())
    await wizard.start()
    const p = wizard.next()
    // Sync-commit guarantee at the façade level.
    expect(wizard.getState().current).toBe('b')
    const r = await p
    expect(r).toEqual({ ok: true, from: 'a', to: 'b', seq: 8 })
    expect(types(events)).toContain('transition.committed')
  })

  it('an async canExit settles the nav promise later; false → guard rejection; throw → failed', async () => {
    let answer: unknown = true
    const def = twoViews({ a: { hooks: { canExit: () => Promise.resolve(answer) } } })
    const { wizard } = make(def)
    await wizard.start()

    const p = wizard.next()
    expect(wizard.getState().nav.phase).toBe('canExit')
    expect(wizard.getState().current).toBe('a')
    expect(await p).toMatchObject({ ok: true, from: 'a', to: 'b' })

    // back to a with a scripted go
    await wizard.go('a')
    answer = false
    expect(await wizard.next()).toMatchObject({
      ok: false,
      reason: 'guard-canExit',
      code: 'GUARD_BLOCKED',
      step: 'a',
    })
    answer = Promise.reject(new Error('guard exploded'))
    const failed = await wizard.next()
    expect(failed).toMatchObject({
      ok: false,
      reason: 'failed',
      code: 'HOOK_FAILED',
      message: 'guard exploded',
      step: 'a',
    })
  })

  it('nav-busy, not-active and unknown-step rejections carry reason + code', async () => {
    const def = twoViews({ a: { hooks: { canExit: () => new Promise(() => {}) } } })
    const { wizard } = make(def)
    expect(await wizard.next()).toMatchObject({
      ok: false,
      reason: 'flow-not-started',
      code: 'FLOW_NOT_STARTED',
    })
    await wizard.start()
    void wizard.next() // hangs in canExit
    expect(await wizard.next()).toMatchObject({ ok: false, reason: 'nav-busy', code: 'NAV_BUSY' })
    expect(await wizard.go('nope')).toMatchObject({ ok: false, code: 'UNKNOWN_STEP' })
    expect(await wizard.go('end')).toMatchObject({
      ok: false,
      reason: 'not-a-view',
      code: 'NOT_A_VIEW',
      step: 'end',
    })
  })

  it('dispatch() of a nav command maps the NavResult to a CommandResult', async () => {
    const { wizard } = make(twoViews())
    await wizard.start()
    expect(await wizard.dispatch({ type: 'next' })).toEqual({ ok: true, seq: 8 })
    expect(await wizard.dispatch({ type: 'go', step: 'end' })).toMatchObject({
      ok: false,
      code: 'NOT_A_VIEW',
      step: 'end',
    })
  })
})

describe('wizard runtime: external events', () => {
  const waitFlow = (buffer = true) =>
    flow({
      events: { ping: stringsBoundary('id'), other: stringsBoundary('id') },
      policies: { unmatchedEvents: { buffer, ttlMs: 1_000 } },
      steps: {
        w: {
          kind: 'wait',
          hooks: { on: { ping: ({ payload }: any) => ({ done: { got: payload } }) } },
          next: { kind: 'static', targets: ['end'] },
        },
        end: { kind: 'final' },
      },
    })

  it('runs the event boundary, then reports delivery / buffering / drop', async () => {
    const { wizard, events } = make(waitFlow())
    await wizard.start()
    const bad = await wizard.send('ping', { id: 5 })
    expect(bad).toEqual({
      ok: false,
      reason: 'rejected',
      code: 'BOUNDARY_REJECTED',
      message: 'payload rejected by the event boundary',
      issues: [{ message: 'id must be a string', path: ['id'] }],
    })
    expect(types(events)).toContain('event.rejected')

    const early = await wizard.send('other', { id: 'o1' })
    expect(early).toEqual({ ok: true, delivered: [], buffered: true, seq: wizard.getState().seq })

    const good = await wizard.send('ping', { id: 'p1' }, { correlationId: 'c1' })
    // Resolves when the routing batch commits (event.received + event.delivered), not when the handler finishes.
    const delivered = events.find((e) => e.type === 'event.delivered' && e.event === 'ping')!
    expect(good).toEqual({ ok: true, delivered: ['w'], buffered: false, seq: delivered.seq })
    expect(wizard.getState().seq).toBeGreaterThan(delivered.seq)
    expect(events.find((e) => e.type === 'event.received' && e.event === 'ping')).toMatchObject({
      payload: { id: 'p1' },
      correlationId: 'c1',
    })
    expect(wizard.getState().steps.w!.output).toEqual({ got: { id: 'p1' } })
    expect(wizard.getState().status).toBe('done')
  })

  it('drops when nothing listens and buffering is off; unknown events are programmer errors', async () => {
    const { wizard } = make(waitFlow(false))
    await wizard.start()
    expect(await wizard.send('other', { id: 'x' })).toEqual({
      ok: false,
      reason: 'dropped',
      code: 'NOT_ACTIVE',
      message: 'no-listener',
    })
    await expect(wizard.send('unknown', {})).rejects.toBeInstanceOf(WizardError)
    await expect(wizard.send('unknown', {})).rejects.toMatchObject({ code: 'UNKNOWN_EVENT' })
  })

  it('dispatch({ type: "send" }) goes through the same boundary door', async () => {
    const { wizard } = make(waitFlow())
    await wizard.start()
    expect(
      await wizard.dispatch({ type: 'send', event: 'ping', payload: { id: 1 } }),
    ).toMatchObject({
      ok: false,
      code: 'BOUNDARY_REJECTED',
      issues: [{ message: 'id must be a string' }],
    })
    expect(await wizard.dispatch({ type: 'send', event: 'zzz', payload: {} })).toMatchObject({
      ok: false,
      code: 'UNKNOWN_EVENT',
    })
    const seqBefore = wizard.getState().seq
    // Routing batch = event.received + event.delivered → seq + 2.
    expect(await wizard.dispatch({ type: 'send', event: 'ping', payload: { id: 'ok' } })).toEqual({
      ok: true,
      seq: seqBefore + 2,
    })
  })
})

describe('wizard runtime: validate() is a pure query', () => {
  it('returns boundary issues, then validate-hook issues, without touching state or events', async () => {
    const def = flow({
      steps: {
        a: {
          kind: 'view',
          input: stringsBoundary('name'),
          hooks: {
            validate: ({ input }: any) =>
              input.name === 'bad' ? [{ message: 'bad name' }] : undefined,
          },
        },
      },
    })
    const { wizard, events } = make(def)
    await wizard.start()
    await wizard.setInput('a', { name: 1 })
    const before = events.length
    expect(await wizard.validate('a')).toEqual([
      { message: 'name must be a string', path: ['name'] },
    ])
    await wizard.setInput('a', { name: 'bad' })
    expect(await wizard.validate('a')).toEqual([{ message: 'bad name' }])
    await wizard.setInput('a', { name: 'good' })
    expect(await wizard.validate('a')).toEqual([])
    expect(events.length - before).toBe(2) // only the two setInput batches
    await expect(wizard.validate('nope')).rejects.toMatchObject({ code: 'UNKNOWN_STEP' })
  })
})

describe('wizard runtime: subscriptions and snapshots', () => {
  it('subscribe fires once per commit, observe streams events, unsubscribe stops both', async () => {
    const { wizard } = make(twoViews())
    const seen: number[] = []
    const evs: string[] = []
    const off1 = wizard.subscribe((s) => seen.push(s.seq))
    const off2 = wizard.observe((e) => evs.push(e.type))
    await wizard.start()
    expect(seen).toEqual([3])
    expect(evs).toEqual(['flow.started', 'step.arrived', 'step.entered'])
    off1()
    off2()
    await wizard.next()
    expect(seen).toEqual([3])
    expect(evs).toHaveLength(3)
  })

  it('getSnapshot() is cached per state and carries the envelope', async () => {
    const { wizard, sched } = make(twoViews())
    const s0 = wizard.getSnapshot()
    expect(s0).toMatchObject({
      v: 1,
      flow: { name: 'test-flow', version: 1 },
      instanceId: 'wiz-1',
      epoch: 0,
      seq: 0,
      savedAt: 1_000,
    })
    expect(wizard.getSnapshot()).toBe(s0)
    sched.advance(10)
    expect(wizard.getSnapshot()).toBe(s0)
    await wizard.start()
    const s1 = wizard.getSnapshot()
    expect(s1).not.toBe(s0)
    expect(s1.seq).toBe(3)
    expect(s1.state).toBe(wizard.getState())
    expect(s1.children).toEqual({})
    expect(wizard.log().map((e) => e.seq)).toEqual([1, 2, 3])
  })
})

describe('wizard runtime: nested flows', () => {
  const child = flow({
    name: 'child',
    steps: {
      t: {
        kind: 'task',
        hooks: { run: ({ context }: any) => ({ echo: context }) },
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

  it('child(step) throws for non-flow steps and before creation; afterwards returns the runtime', async () => {
    const { wizard, events } = make(parent)
    expect(() => wizard.child('end')).toThrow(WizardError)
    expect(() => wizard.child('f')).toThrowError(/not been created/)
    await wizard.start()
    const c = wizard.child('f')
    expect(c.path).toEqual(['f'])
    expect(c.getState().status).toBe('done')
    expect(c.getState().steps.t!.output).toEqual({ echo: { tenant: 't1' } })
    expect(wizard.getState().status).toBe('done')
    expect(events.filter((e) => e.path[0] === 'f').length).toBeGreaterThan(0)
    expect(wizard.getSnapshot().children.f?.instanceId).toBe(c.id)
  })

  it('dispatch({ type: "child" }) goes through the parent FIFO: the parent machine gates it and plans child.send', async () => {
    const asyncChild = flow({
      name: 'child',
      steps: {
        w: {
          kind: 'wait',
          hooks: { on: { ping: () => ({ done: 'pinged' }) } },
          next: { kind: 'static', targets: ['cend'] },
        },
        cend: { kind: 'final' },
      },
    })
    const p = flow({
      name: 'parent',
      events: { ping: stringsBoundary('id') },
      steps: {
        f: { kind: 'flow', child: asyncChild, next: { kind: 'static', targets: ['end'] } },
        end: { kind: 'final' },
      },
    })
    const { wizard, events } = make(p)
    // Not started yet: the toy machine rejects (terminal/idle gates live in the parent machine).
    expect(
      await wizard.dispatch({ type: 'child', path: ['end'], command: { type: 'runReady' } }),
    ).toMatchObject({ ok: false, code: 'NOT_A_FLOW_STEP' })
    expect(
      await wizard.dispatch({ type: 'child', path: ['f'], command: { type: 'runReady' } }),
    ).toMatchObject({ ok: false, code: 'NOT_ACTIVE' })
    await wizard.start()
    const seqBefore = wizard.getState().seq
    // Accepted: one parent event (child.command) → the promise resolves with the PARENT seq;
    // the child receives the command through the bridge (child.send) inside the same drain.
    const r = await wizard.dispatch({
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
    const before = wizard.child('f').getState().seq
    await wizard.dispatch({
      type: 'child',
      path: ['f'],
      command: { type: 'send', event: 'ping', payload: { id: 'x' } },
    })
    // The child flow declares no events → its dispatch answers UNKNOWN_EVENT (no state change).
    expect(wizard.child('f').getState().seq).toBe(before)
    expect(wizard.child('f').getState().status).toBe('waiting')
  })
})

describe('wizard runtime: dispose', () => {
  it('rejects further calls with DISPOSED and settles pending navigation promises', async () => {
    const def = twoViews({ a: { hooks: { canExit: () => new Promise(() => {}) } } })
    const { wizard } = make(def)
    await wizard.start()
    const pending = wizard.next()
    wizard.dispose()
    expect(wizard.isDisposed()).toBe(true)
    expect(await pending).toEqual({
      ok: false,
      reason: 'failed',
      code: 'DISPOSED',
      message: 'wizard disposed',
    })
    await expect(wizard.next()).rejects.toMatchObject({ code: 'DISPOSED' })
    await expect(wizard.dispatch({ type: 'start' })).rejects.toMatchObject({ code: 'DISPOSED' })
    expect(() => wizard.subscribe(() => {})).toThrow(WizardError)
    // Reads still work for post-mortem.
    expect(wizard.getState().current).toBe('a')
    wizard.dispose() // idempotent
  })

  it("strict: 'sync' is honoured", async () => {
    const def = flow({
      steps: {
        t: {
          kind: 'task',
          hooks: { run: async () => 1 },
          next: { kind: 'static', targets: ['end'] },
        },
        end: { kind: 'final' },
      },
    })
    const { wizard } = make(def, { strict: 'sync' })
    await wizard.start()
    expect(wizard.getState().steps.t!.error?.kind).toBe('sync-violation')
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
    const { wizard } = make(def)
    await wizard.start()
    const sending = wizard.send('slow', { id: 1 })
    const validating = wizard.validate('a')
    wizard.dispose()
    expect(await sending).toEqual({
      ok: false,
      reason: 'dropped',
      code: 'DISPOSED',
      message: 'wizard disposed',
    })
    await expect(validating).rejects.toMatchObject({ code: 'DISPOSED' })
    expect(signal?.aborted).toBe(true)
    // The abandoned boundary settling later is harmless (handlers attached; nothing enqueued).
    releaseBoundary({ ok: true, value: {} })
    await Promise.resolve()
    await Promise.resolve()
    expect(wizard.log().some((e) => e.type === 'event.received')).toBe(false)
  })
})

describe('wizard runtime: sync-commit guarantee for send()', () => {
  it('a sync boundary enqueues before send() returns and the promise is already fulfilled', async () => {
    const def = flow({
      events: { ping: stringsBoundary('id') },
      steps: {
        w: {
          kind: 'wait',
          hooks: { on: { ping: () => ({ done: 'ok' }) } },
          next: { kind: 'static', targets: ['end'] },
        },
        end: { kind: 'final' },
      },
    })
    const { wizard, events } = make(def)
    await wizard.start()
    // A rejected boundary: sendRejected is enqueued synchronously and the promise is fulfilled.
    const p2 = wizard.send('ping', { id: 2 })
    expect(types(events)).toContain('event.rejected')
    let fulfilled2 = false
    void p2.then(() => {
      fulfilled2 = true
    })
    await Promise.resolve()
    expect(fulfilled2).toBe(true)
    // A passing boundary: committed before the call returned — routing AND the sync handler ran.
    const p = wizard.send('ping', { id: 'p1' })
    expect(types(events)).toContain('event.delivered')
    expect(wizard.getState().status).toBe('done')
    let fulfilled = false
    void p.then(() => {
      fulfilled = true
    })
    await Promise.resolve()
    expect(fulfilled).toBe(true)
  })

  it('every sync command promise is already fulfilled when returned (start/next/setInput/dispatch)', async () => {
    const { wizard } = make(twoViews())
    const checks: Array<Promise<unknown>> = [wizard.start()]
    checks.push(
      wizard.setInput('a', { x: 1 }),
      wizard.next(),
      wizard.dispatch({ type: 'go', step: 'a' }),
    )
    const settled = checks.map(() => false)
    checks.forEach((p, i) => {
      void p.then(() => {
        settled[i] = true
      })
    })
    await Promise.resolve()
    expect(settled).toEqual([true, true, true, true])
    expect(wizard.getState().current).toBe('a')
  })

  it("preserves a hook error's WizardError code (SYNC_VIOLATION) through NavResult and CommandResult", async () => {
    const def = twoViews({ a: { hooks: { canExit: async () => true } } })
    const { wizard } = make(def, { strict: 'sync' })
    await wizard.start()
    const nav = await wizard.next()
    expect(nav).toMatchObject({ ok: false, reason: 'failed', code: 'SYNC_VIOLATION', step: 'a' })
    expect(await wizard.dispatch({ type: 'next' })).toMatchObject({
      ok: false,
      code: 'SYNC_VIOLATION',
      step: 'a',
    })
  })
})

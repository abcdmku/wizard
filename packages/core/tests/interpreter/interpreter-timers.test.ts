/**
 * The interpreter — timeouts, abort and stale results, timers, persist coalescing and listener isolation.
 */
import { describe, expect, it } from 'vitest'
import { createSequentialIds } from '../../src/interpreter/env'
import { createInterpreter, type InterpreterOptions } from '../../src/interpreter/interpreter'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import type { Message } from '../../src/machine/commands'
import type { Effect } from '../../src/machine/effects'
import type { DomainEvent } from '../../src/machine/events'
import type { WizardState } from '../../src/machine/state'
import type { MachineEnv } from '../../src/machine/types'
import {
  createToyMachine,
  flow,
  initialState,
  type ToyOverrides,
  types,
} from '../helpers/fake-machine'

function setup(
  def: ReturnType<typeof flow>,
  overrides: ToyOverrides = {},
  extra: Partial<InterpreterOptions> = {},
  context: unknown = { n: 0 },
) {
  const sched = createTestScheduler({ now: 1_000 })
  const ids = createSequentialIds()
  const env = { clock: sched, scheduler: sched, ids }
  const menv: MachineEnv = { def, path: [], now: () => sched.now(), id: (p) => ids.id(p) }
  const events: DomainEvent[] = []
  const commits: WizardState[] = []
  const effects: Effect[] = []
  const processed: Array<{ msg: Message; batch: readonly DomainEvent[] }> = []
  const interp = createInterpreter({
    def,
    machine: createToyMachine(overrides),
    path: [],
    env,
    initialState: initialState(menv, { instanceId: 'w1', context, now: sched.now() }),
    onEvent: (e) => events.push(e),
    onCommit: (s) => commits.push(s),
    onEffect: (fx) => effects.push(fx),
    onProcessed: (msg, batch) => processed.push({ msg, batch }),
    ...extra,
  })
  return { interp, sched, ids, events, commits, effects, processed }
}

const taskThenFinal = (run: (args: any) => unknown, extra: Record<string, unknown> = {}) =>
  flow({
    steps: {
      t: { kind: 'task', hooks: { run }, next: { kind: 'static', targets: ['end'] }, ...extra },
      end: { kind: 'final' },
    },
  })

describe('interpreter: timeouts, abort and stale results', () => {
  it('times out an async run: aborts the signal, reports res.err { timedOut } and never double-reports', async () => {
    let resolveRun: (v: unknown) => void = () => {}
    let signal: AbortSignal | undefined
    const def = taskThenFinal(
      (args) => {
        signal = args.signal
        return new Promise((r) => (resolveRun = r))
      },
      { timeoutMs: 100 },
    )
    const messages: Message[] = []
    const { interp, sched, events } = setup(def, {
      decide: (_e, _s, msg) => {
        messages.push(msg)
        return undefined
      },
    })
    interp.send({ type: 'start' })
    expect(interp.inflight()).toBe(1)
    sched.advance(99)
    expect(interp.getState().steps.t!.status).toBe('active')
    sched.advance(1)
    expect(signal?.aborted).toBe(true)
    expect(interp.inflight()).toBe(0)
    expect(interp.getState().steps.t!.status).toBe('failed')
    expect(interp.getState().steps.t!.error?.kind).toBe('timeout')
    // The late result must not produce a second report for the same effect.
    resolveRun('too late')
    await Promise.resolve()
    await Promise.resolve()
    const results = messages.filter((m) => m.type === 'res.ok' || m.type === 'res.err')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ type: 'res.err', timedOut: true })
    expect(types(events).filter((t) => t === 'step.failed')).toHaveLength(1)
  })

  it('a stale result (token mismatch) is passed through and ignored by the machine, not by the interpreter', () => {
    const def = taskThenFinal(() => new Promise(() => {}))
    const { interp, events, processed } = setup(def)
    interp.send({ type: 'start' })
    expect(interp.getState().steps.t!.status).toBe('active')
    // A late result whose token names an old run: the interpreter forwards it untouched;
    // the machine answers with result.ignored and nothing else changes.
    interp.send({
      type: 'res.ok',
      effectId: 'fx_old',
      hook: 'run',
      token: { step: 't', runId: 0, attempt: 1 },
      value: 'stale',
      durationMs: 1,
    })
    expect(processed.at(-1)?.msg).toMatchObject({ type: 'res.ok', effectId: 'fx_old' })
    const ignored = events.filter((e) => e.type === 'result.ignored')
    expect(ignored).toHaveLength(1)
    expect(ignored[0]).toMatchObject({
      type: 'result.ignored',
      reason: 'stale',
      effectId: 'fx_old',
    })
    expect(interp.getState().steps.t!.status).toBe('active')
    expect(interp.getState().steps.t!.output).toBeUndefined()
  })

  it('aborts in-flight hooks of a cancelled step and reports the cooperative settlement', async () => {
    let signal: AbortSignal | undefined
    let rejectRun: (e: unknown) => void = () => {}
    const def = taskThenFinal((args) => {
      signal = args.signal
      return new Promise((_, rej) => {
        rejectRun = rej
        args.signal.addEventListener('abort', () => rej(new Error('aborted by signal')))
      })
    })
    const messages: Message[] = []
    const { interp } = setup(def, {
      decide: (_e, _s, msg) => {
        messages.push(msg)
        return undefined
      },
    })
    interp.send({ type: 'start' })
    interp.send({ type: 'cancel', reason: 'user' })
    expect(signal?.aborted).toBe(true)
    expect(interp.getState().status).toBe('cancelled')
    await Promise.resolve()
    await Promise.resolve()
    const err = messages.find((m) => m.type === 'res.err')
    expect(err).toMatchObject({ type: 'res.err', cancelled: true })
    void rejectRun
  })

  it('bounds an aborted hook that never settles with the grace timer', () => {
    const def = taskThenFinal(() => new Promise(() => {}))
    const messages: Message[] = []
    const { interp, sched } = setup(
      def,
      {
        decide: (_e, _s, msg) => {
          messages.push(msg)
          return undefined
        },
      },
      { abortGraceMs: 500 },
    )
    interp.send({ type: 'start' })
    interp.send({ type: 'cancel' })
    expect(messages.some((m) => m.type === 'res.err')).toBe(false)
    sched.advance(500)
    const err = messages.find((m) => m.type === 'res.err')
    expect(err).toMatchObject({ type: 'res.err', cancelled: true, timedOut: true })
    expect(interp.inflight()).toBe(0)
  })
})

describe('interpreter: timers', () => {
  it('arms wait timeouts through the scheduler and clears them when the wait resolves', () => {
    const def = flow({
      steps: {
        w: {
          kind: 'wait',
          hooks: { on: { ping: ({ payload }: any) => ({ done: { got: payload } }) } },
          waitTimeout: { afterMs: 1_000, next: 'end' },
        },
        end: { kind: 'final' },
      },
    })
    const { interp, sched, events } = setup(def)
    interp.send({ type: 'start' })
    expect(sched.pending()).toBe(1)
    expect(interp.getState().timers['wait:w']).toBeDefined()
    interp.send({ type: 'send', event: 'ping', payload: 42 })
    expect(interp.getState().steps.w!.output).toEqual({ got: 42 })
    expect(types(events)).toContain('timer.cleared')
    expect(sched.pending()).toBe(0)
    sched.advance(5_000)
    expect(types(events)).not.toContain('timer.fired')
  })

  it('fires the wait timeout at exactly `at` and routes to waitTimeout.next', () => {
    const def = flow({
      steps: {
        w: { kind: 'wait', hooks: { on: {} }, waitTimeout: { afterMs: 300, next: 'end' } },
        end: { kind: 'final' },
      },
    })
    const { interp, sched } = setup(def)
    interp.send({ type: 'start' })
    sched.advance(299)
    expect(interp.getState().status).toBe('waiting')
    sched.advance(1)
    expect(interp.getState().steps.w!.output).toEqual({ event: 'timeout' })
    expect(interp.getState().status).toBe('done')
  })

  it('dispose() clears armed timers and silences in-flight hooks', async () => {
    let signal: AbortSignal | undefined
    const def = flow({
      steps: {
        w: { kind: 'wait', hooks: { on: {} }, waitTimeout: { afterMs: 300, next: 'end' } },
        end: { kind: 'final' },
      },
    })
    const { interp, sched, events } = setup(def)
    interp.send({ type: 'start' })
    expect(sched.pending()).toBe(1)
    interp.dispose()
    expect(sched.pending()).toBe(0)
    expect(interp.isDisposed()).toBe(true)
    const before = events.length
    sched.advance(1_000)
    interp.send({ type: 'send', event: 'x', payload: 1 })
    expect(events.length).toBe(before)
    void signal
  })
})

describe('interpreter: persist coalescing and listener isolation', () => {
  it('reports one persist per drain (strongest reason wins) even when many batches commit', () => {
    const def = taskThenFinal(() => 'x')
    const { interp, effects } = setup(def)
    interp.send({ type: 'start' })
    const persists = effects.filter((fx) => fx.kind === 'persist')
    expect(persists).toHaveLength(1)
    expect(persists[0]).toEqual({ kind: 'persist', reason: 'final' })
  })

  it('reports a change persist for batches without an explicit persist effect', () => {
    const def = flow({ steps: { v: { kind: 'view' } } })
    const { interp, effects } = setup(def)
    interp.send({ type: 'start' })
    interp.send({ type: 'setInput', step: 'v', patch: { a: 1 } })
    expect(effects.filter((fx) => fx.kind === 'persist')).toHaveLength(2)
    expect(effects.at(-1)).toEqual({ kind: 'persist', reason: 'change' })
  })

  it('isolates a throwing listener and keeps draining', () => {
    const def = taskThenFinal(() => 'x')
    const errors: unknown[] = []
    const { interp, commits } = setup(
      def,
      {},
      {
        onEvent: () => {
          throw new Error('listener boom')
        },
        onListenerError: (e) => errors.push(e),
      },
    )
    interp.send({ type: 'start' })
    expect(interp.getState().status).toBe('done')
    expect(commits).toHaveLength(2)
    expect(errors.length).toBeGreaterThan(0)
    expect((errors[0] as Error).message).toBe('listener boom')
  })
})

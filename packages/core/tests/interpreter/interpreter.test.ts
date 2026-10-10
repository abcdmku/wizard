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

describe('interpreter: batch atomicity', () => {
  it('event listeners only ever observe post-batch state', () => {
    const def = taskThenFinal(() => 'out')
    const seen: Array<{ type: string; status: string; attempt: number }> = []
    const { interp } = setup(
      def,
      {},
      {
        onEvent: (e) => {
          const s = interp.getState()
          seen.push({ type: e.type, status: s.steps.t!.status, attempt: s.steps.t!.attempt })
        },
      },
    )
    interp.send({ type: 'start' })
    // The very first event of the first batch already sees the whole batch applied
    // (task active with attempt 1, set by the last event of that batch).
    expect(seen[0]).toEqual({ type: 'flow.started', status: 'active', attempt: 1 })
    expect(seen.map((s) => s.type)).toContain('step.runSucceeded')
    // Events from the second batch (run result) see the task done.
    const done = seen.find((s) => s.type === 'step.runSucceeded')
    expect(done?.status).toBe('done')
  })

  it('reports a message the machine ignores as processed with an empty batch (no commit)', () => {
    const def = flow({ steps: { v: { kind: 'view' } } })
    const { interp, commits, processed } = setup(def)
    interp.send({ type: 'start' })
    expect(commits).toHaveLength(1)
    interp.send({ type: 'runReady' }) // toy machine: [] for this command
    expect(commits).toHaveLength(1)
    expect(processed.at(-1)?.msg).toEqual({ type: 'runReady' })
    expect(processed.at(-1)?.batch).toEqual([])
  })

  it('assigns monotonic seq, batch timestamp and path envelopes', () => {
    const def = taskThenFinal(() => 1)
    const { interp, events, sched } = setup(def)
    sched.advance(5)
    interp.send({ type: 'start' })
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1))
    expect(events.every((e) => e.at === 1_005)).toBe(true)
    expect(events.every((e) => e.path.length === 0)).toBe(true)
    expect(interp.getState().seq).toBe(events.length)
  })
})

describe('interpreter: sync-commit guarantee', () => {
  it('a sync hook chain is fully committed before send() returns', () => {
    const def = taskThenFinal(() => ({ ok: true }))
    const { interp } = setup(def)
    interp.send({ type: 'start' })
    const s = interp.getState()
    expect(s.steps.t!.status).toBe('done')
    expect(s.steps.t!.output).toEqual({ ok: true })
    expect(s.status).toBe('done')
  })

  it('an async hook commits only the pre-effect batch synchronously; the result lands in a later drain', async () => {
    let resolveRun: (v: unknown) => void = () => {}
    const def = taskThenFinal(() => new Promise((r) => (resolveRun = r)))
    const { interp, commits } = setup(def)
    interp.send({ type: 'start' })
    expect(interp.getState().steps.t!.status).toBe('active')
    expect(interp.getState().status).toBe('running')
    expect(commits).toHaveLength(1)
    resolveRun('later')
    await Promise.resolve()
    await Promise.resolve()
    expect(interp.getState().steps.t!.status).toBe('done')
    expect(interp.getState().steps.t!.output).toBe('later')
    expect(interp.getState().status).toBe('done')
    expect(commits).toHaveLength(2)
  })

  it("strict: 'sync' turns a thenable into res.err { syncViolation } in the same drain", () => {
    const def = taskThenFinal(() => Promise.resolve('never'))
    const messages: Message[] = []
    const { interp, events } = setup(
      def,
      {
        decide: (_e, _s, msg) => {
          messages.push(msg)
          return undefined
        },
      },
      { strict: 'sync' },
    )
    interp.send({ type: 'start' })
    const err = messages.find((m) => m.type === 'res.err')
    expect(err).toMatchObject({ type: 'res.err', hook: 'run', syncViolation: true })
    expect(err && err.type === 'res.err' ? err.error.code : undefined).toBe('SYNC_VIOLATION')
    expect(interp.getState().steps.t!.status).toBe('failed')
    expect(interp.getState().steps.t!.error?.kind).toBe('sync-violation')
    expect(types(events)).toContain('flow.failed')
  })
})

describe('interpreter: re-entrancy', () => {
  it('send() from a listener is enqueued and processed before the outer call returns', () => {
    const def = flow({
      steps: {
        v: { kind: 'view', next: { kind: 'static', targets: ['end'] } },
        end: { kind: 'final' },
      },
    })
    let inputSeenInsideListener: unknown = 'unset'
    let sent = false
    const { interp, events } = setup(
      def,
      {},
      {
        onCommit: () => {
          if (sent) return
          sent = true
          interp.send({ type: 'setInput', step: 'v', patch: { name: 'x' } })
          // Not processed yet: we are inside the outer drain.
          inputSeenInsideListener = interp.getState().steps.v!.input
        },
      },
    )
    interp.send({ type: 'start' })
    expect(inputSeenInsideListener).toBeUndefined()
    expect(interp.getState().steps.v!.input).toEqual({ name: 'x' })
    expect(types(events)).toEqual(['flow.started', 'step.arrived', 'step.entered', 'input.changed'])
  })

  it('a hook calling update() enqueues context.patch, applied before the hook result', () => {
    const def = taskThenFinal(({ update }) => {
      update({ touched: true })
      return 'r'
    })
    const { interp, events } = setup(def, {}, {}, { touched: false })
    interp.send({ type: 'start' })
    const order = types(events)
    expect(order.indexOf('context.changed')).toBeLessThan(order.indexOf('step.runSucceeded'))
    const changed = events.find((e) => e.type === 'context.changed')
    expect(changed).toMatchObject({ type: 'context.changed', patch: { touched: true }, by: 't' })
    expect(interp.getState().context).toEqual({ touched: true })
  })
})

describe('interpreter: causality', () => {
  it('links effect results to the event that planned the effect (causedBy)', () => {
    const def = taskThenFinal(() => 'x')
    const { interp, events } = setup(def)
    interp.send({ type: 'start' })
    const runStarted = events.find((e) => e.type === 'step.runStarted')!
    const succeeded = events.find((e) => e.type === 'step.runSucceeded')!
    expect(succeeded.causedBy).toBe(runStarted.seq)
    // Public commands have no cause.
    expect(events[0]!.causedBy).toBeUndefined()
    // durationMs is stamped on events produced by hook results.
    expect(succeeded.durationMs).toBe(0)
  })

  it('links timer-fired messages to the timer.scheduled event', () => {
    const def = flow({
      steps: {
        w: {
          kind: 'wait',
          hooks: { on: { ping: () => undefined } },
          waitTimeout: { afterMs: 50, next: 'end' },
        },
        end: { kind: 'final' },
      },
    })
    const { interp, events, sched } = setup(def)
    interp.send({ type: 'start' })
    const scheduled = events.find((e) => e.type === 'timer.scheduled')!
    sched.advance(50)
    const fired = events.find((e) => e.type === 'timer.fired')!
    expect(fired.causedBy).toBe(scheduled.seq)
    expect(interp.getState().status).toBe('done')
  })
})

describe('interpreter: log ring', () => {
  it('keeps at most logSize events, newest last', () => {
    const def = taskThenFinal(() => 'x')
    const { interp, events } = setup(def, {}, { logSize: 5 })
    interp.send({ type: 'start' })
    expect(events.length).toBeGreaterThan(5)
    const log = interp.log()
    expect(log).toHaveLength(5)
    expect(log.map((e) => e.seq)).toEqual(events.slice(-5).map((e) => e.seq))
    // log() returns a copy
    expect(interp.log()).not.toBe(log)
  })
})

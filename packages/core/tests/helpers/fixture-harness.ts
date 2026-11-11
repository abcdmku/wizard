/** Drives the pure machine and records event batches and effects. */
import type { CompiledWizard } from '../../src/authoring/compiled'
import type { Command, HookName, Message, ResultToken } from '../../src/machine/commands'
import type { CallEffect, Effect } from '../../src/machine/effects'
import type { DomainEvent, DomainEventBody, DomainEventType } from '../../src/machine/events'
import { initialState, machine } from '../../src/machine/index'
import type { ChildSummary, SerializedError, WizardState } from '../../src/machine/state'
import type { MachineEnv } from '../../src/machine/types'

export interface TestClock {
  now: number
  advance(ms: number): void
}

export function createEnv(
  def: CompiledWizard,
  opts: { now?: number; path?: readonly string[] } = {},
) {
  const clock: TestClock = {
    now: opts.now ?? 1_000,
    advance(ms) {
      clock.now += ms
    },
  }
  const counters = new Map<string, number>()
  const env: MachineEnv = {
    def,
    path: opts.path ?? [],
    now: () => clock.now,
    random: () => 0.5,
    id: (prefix) => {
      const n = (counters.get(prefix) ?? 0) + 1
      counters.set(prefix, n)
      return `${prefix}-${n}`
    },
  }
  return { env, clock }
}

export interface BatchResult {
  readonly events: readonly DomainEvent[]
  readonly effects: readonly Effect[]
  readonly types: readonly DomainEventType[]
  readonly state: WizardState
}

export interface Harness {
  readonly env: MachineEnv
  readonly clock: TestClock
  readonly def: CompiledWizard
  state: WizardState
  /** Every event ever committed (all batches). */
  readonly log: DomainEvent[]
  /** Every effect ever planned. */
  readonly effects: Effect[]
  /** decide (its folded state adopted, envelopes assigned) → plan; records and returns the batch. */
  step(msg: Message): BatchResult
  cmd(cmd: Command | Command['type']): BatchResult
  start(): BatchResult
  /** Planned `call` effects not yet answered (optionally filtered by hook and/or step). */
  pending(hook?: HookName, step?: string): CallEffect[]
  /** The most recent unanswered call for `hook` (throws when none). */
  call(hook: HookName, step?: string): CallEffect
  ok(call: CallEffect, value?: unknown): BatchResult
  err(
    call: CallEffect,
    error?: string | SerializedError,
    opts?: { timedOut?: boolean; issues?: readonly { message: string }[] },
  ): BatchResult
  fire(timerId: string): BatchResult
  /**
   * Push a `res.child`. Defaults: token = the step's current `{ step, runId }`,
   * `summary.seq` = previous child seq + 1 (monotonic). Override via `extra`.
   */
  child(
    step: string,
    summary: Partial<ChildSummary>,
    extra?: {
      done?: { output: unknown }
      failed?: { error: SerializedError }
      phase?: 'compensated'
      token?: ResultToken
    },
  ): BatchResult
  rec(step: string): WizardState['steps'][string]
}

export function createHarness(
  def: CompiledWizard,
  opts: {
    now?: number
    context?: unknown
    instanceId?: string
    path?: readonly string[]
    correlationId?: string
  } = {},
): Harness {
  const { env, clock } = createEnv(def, {
    ...(opts.now !== undefined ? { now: opts.now } : {}),
    ...(opts.path !== undefined ? { path: opts.path } : {}),
  })
  const answered = new Set<string>()
  const h: Harness = {
    env,
    clock,
    def,
    state: initialState(env, {
      instanceId: opts.instanceId ?? 'inst-1',
      context: opts.context ?? {},
      now: clock.now,
      ...(opts.correlationId !== undefined ? { correlationId: opts.correlationId } : {}),
    }),
    log: [],
    effects: [],
    step(msg) {
      const decision = machine.decide(env, h.state, msg)
      const events = envelope(env, h.state.seq, decision.events, decision.at)
      const s = decision.state
      const effects = machine.plan(env, s, events)
      h.state = s
      h.log.push(...events)
      h.effects.push(...effects)
      return { events, effects, types: events.map((e) => e.type), state: s }
    },
    cmd(c) {
      return h.step(typeof c === 'string' ? ({ type: c } as Command) : c)
    },
    start() {
      return h.step({ type: 'start' })
    },
    pending(hook, step) {
      return h.effects.filter(
        (e): e is CallEffect =>
          e.kind === 'call' &&
          !answered.has(e.effectId) &&
          (hook === undefined || e.hook === hook) &&
          (step === undefined || e.step === step),
      )
    },
    call(hook, step) {
      const list = h.pending(hook, step)
      const last = list[list.length - 1]
      if (last === undefined)
        throw new Error(
          `no pending call for hook '${hook}'${step !== undefined ? ` on '${step}'` : ''}`,
        )
      return last
    },
    ok(c, value) {
      answered.add(c.effectId)
      return h.step({
        type: 'res.ok',
        effectId: c.effectId,
        hook: c.hook,
        token: c.token,
        value,
        durationMs: 0,
        ...(c.extra !== undefined ? { extra: c.extra } : {}),
      })
    },
    err(c, error = 'boom', o = {}) {
      answered.add(c.effectId)
      const err: SerializedError =
        typeof error === 'string' ? { name: 'Error', message: error } : error
      return h.step({
        type: 'res.err',
        effectId: c.effectId,
        hook: c.hook,
        token: c.token,
        error: err,
        durationMs: 0,
        ...(o.timedOut !== undefined ? { timedOut: o.timedOut } : {}),
        ...(o.issues !== undefined ? { issues: o.issues } : {}),
        ...(c.extra !== undefined ? { extra: c.extra } : {}),
      })
    },
    fire(timerId) {
      return h.step({ type: 'timer.fired', timerId })
    },
    child(step, summary, extra = {}) {
      const r = h.state.steps[step]
      const seq = (r?.child?.seq ?? 0) + 1
      return h.step({
        type: 'res.child',
        step,
        token: extra.token ?? { step, runId: r?.runId ?? 0 },
        summary: { status: 'running', current: null, progress: 0, seq, ...summary },
        ...(extra.done !== undefined ? { done: extra.done } : {}),
        ...(extra.failed !== undefined ? { failed: extra.failed } : {}),
        ...(extra.phase !== undefined ? { phase: extra.phase } : {}),
      })
    },
    rec(step) {
      const r = h.state.steps[step]
      if (r === undefined) throw new Error(`unknown step '${step}'`)
      return r
    },
  }
  return h
}

/** Assign envelopes to a batch of event bodies (seq continues from `fromSeq`). */
export function envelope(
  env: MachineEnv,
  fromSeq: number,
  bodies: readonly DomainEventBody[],
  at = env.now(),
): DomainEvent[] {
  return bodies.map((body, i) => ({ ...body, seq: fromSeq + i + 1, at, path: env.path }))
}

/** Fold the whole log from the initial state again (must equal `h.state`). */
export function replay(
  h: Harness,
  opts: { context?: unknown; instanceId?: string } = {},
): WizardState {
  const first = h.log[0]
  let s = initialState(h.env, {
    instanceId: opts.instanceId ?? h.state.instanceId,
    context: opts.context ?? {},
    now: first?.at ?? h.clock.now,
    ...(h.state.correlationId !== undefined ? { correlationId: h.state.correlationId } : {}),
  })
  for (const ev of h.log) s = machine.apply(h.env, s, ev)
  return s
}

/** Pick the events of one type from a batch. */
export function of<T extends DomainEventType>(
  r: BatchResult | readonly DomainEvent[],
  type: T,
): Extract<DomainEvent, { type: T }>[] {
  const list = Array.isArray(r) ? (r as readonly DomainEvent[]) : (r as BatchResult).events
  return list.filter((e): e is Extract<DomainEvent, { type: T }> => e.type === type)
}

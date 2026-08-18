/**
 * Test fixtures for the machine (shared with the interpreter tests).
 *
 * - `flow({...})` + `view/task/wait/decision/flowStep/final` build `CompiledFlow`
 *   literals with tiny hooks (no authoring layer involved).
 * - `createHarness(def)` drives the pure machine: `decide` → fold with `apply`
 *   (assigning envelopes) → `plan`; it records the full log and lets a test
 *   answer planned `call` effects (`ok` / `err`), fire timers and push child
 *   results. `replay(h)` re-folds the whole log from the initial state.
 */

import type {
  CompiledFlow,
  CompiledStep,
  DepsSpec,
  ExposeSpec,
  Hook,
  NextRef,
  OnHandlerResult,
  RetryPolicy,
  RuntimeBoundary,
  StepKind,
} from '../../src/authoring/compiled'
import type { Command, HookName, Message, ResultToken } from '../../src/machine/commands'
import type { CallEffect, Effect } from '../../src/machine/effects'
import type { DomainEvent, DomainEventBody, DomainEventType } from '../../src/machine/events'
import { initialState, machine } from '../../src/machine/index'
import type { ChildSummary, SerializedError, WizardState } from '../../src/machine/state'
import type { MachineEnv } from '../../src/machine/types'

// ---------------------------------------------------------------------------
// Boundaries
// ---------------------------------------------------------------------------

export const trusted = (): RuntimeBoundary => ({
  kind: 'trusted',
  parse: (value) => ({ ok: true, value }),
})

/** Boundary from a predicate: `ok` when `check(value)` returns true. */
export const guard = (check: (v: unknown) => boolean, message = 'invalid'): RuntimeBoundary => ({
  kind: 'guard',
  parse: (value) => (check(value) ? { ok: true, value } : { ok: false, issues: [{ message }] }),
})

// ---------------------------------------------------------------------------
// Step builders
// ---------------------------------------------------------------------------

type Next = NextRef | undefined

interface CommonCfg {
  readonly next?: Next
  readonly dynamicNext?: Hook<NextRef>
  readonly dependsOn?: DepsSpec | readonly string[]
  readonly canEnter?: Hook<boolean>
  readonly canExit?: Hook<boolean>
  readonly enter?: Hook<void>
  readonly exit?: Hook<void>
  readonly label?: string
  readonly expose?: ExposeSpec
}

export interface ViewCfg extends CommonCfg {
  readonly input?: RuntimeBoundary
  readonly initial?: unknown
  readonly validate?: CompiledStep['hooks']['validate']
}
export interface TaskCfg extends CommonCfg {
  readonly run?: Hook<unknown>
  readonly output?: RuntimeBoundary
  readonly retry?: RetryPolicy
  readonly timeoutMs?: number
  readonly compensate?: Hook<void>
}
export interface WaitCfg extends CommonCfg {
  readonly on?: Readonly<Record<string, Hook<OnHandlerResult>>>
  readonly timeout?: { readonly afterMs: number; readonly next: string }
}
export interface DecisionCfg extends CommonCfg {
  readonly decide?: Hook<NextRef>
}
export interface FlowStepCfg extends CommonCfg {
  readonly context?: Hook<unknown>
  readonly output?: Hook<unknown>
  readonly compensate?: Hook<void>
}
export interface FinalCfg extends CommonCfg {
  readonly output?: Hook<unknown>
}

type StepSpec = Omit<CompiledStep, 'id'>

const noop: Hook<void> = () => undefined
const NO_EXPOSE: ExposeSpec = { input: true, output: false }

function nextOf(cfg: CommonCfg): CompiledStep['next'] {
  if (cfg.dynamicNext !== undefined) return { kind: 'dynamic' }
  if (cfg.next === undefined || cfg.next === null) return { kind: 'none' }
  return { kind: 'static', targets: typeof cfg.next === 'string' ? [cfg.next] : [...cfg.next] }
}

function depsOf(d: CommonCfg['dependsOn']): DepsSpec | undefined {
  if (d === undefined) return undefined
  return Array.isArray(d) ? { all: [...d] } : (d as DepsSpec)
}

function base(kind: StepKind, cfg: CommonCfg, hooks: CompiledStep['hooks']): StepSpec {
  const deps = depsOf(cfg.dependsOn)
  return {
    kind,
    next: nextOf(cfg),
    ...(deps !== undefined ? { dependsOn: deps } : {}),
    ...(cfg.label !== undefined ? { label: cfg.label } : {}),
    hooks: {
      ...(cfg.canEnter !== undefined ? { canEnter: cfg.canEnter } : {}),
      ...(cfg.canExit !== undefined ? { canExit: cfg.canExit } : {}),
      ...(cfg.enter !== undefined ? { enter: cfg.enter } : {}),
      ...(cfg.exit !== undefined ? { exit: cfg.exit } : {}),
      ...(cfg.dynamicNext !== undefined ? { next: cfg.dynamicNext } : {}),
      ...hooks,
    },
    expose: cfg.expose ?? NO_EXPOSE,
  }
}

export const view = (cfg: ViewCfg = {}): StepSpec => ({
  ...base('view', cfg, cfg.validate !== undefined ? { validate: cfg.validate } : {}),
  ...(cfg.input !== undefined ? { input: cfg.input } : {}),
  ...(cfg.initial !== undefined ? { initial: cfg.initial } : {}),
})

export const task = (cfg: TaskCfg = {}): StepSpec => ({
  ...base('task', cfg, {
    run: cfg.run ?? noop,
    ...(cfg.compensate !== undefined ? { compensate: cfg.compensate } : {}),
  }),
  ...(cfg.output !== undefined ? { output: cfg.output } : {}),
  ...(cfg.retry !== undefined ? { retry: cfg.retry } : {}),
  ...(cfg.timeoutMs !== undefined ? { timeoutMs: cfg.timeoutMs } : {}),
})

export const wait = (cfg: WaitCfg = {}): StepSpec => ({
  ...base('wait', cfg, { on: cfg.on ?? {} }),
  ...(cfg.timeout !== undefined ? { waitTimeout: cfg.timeout } : {}),
})

export const decision = (cfg: DecisionCfg = {}): StepSpec => {
  const spec = base('decision', cfg, { next: cfg.decide ?? (() => null) })
  return { ...spec, next: { kind: 'dynamic' } }
}

export const flowStep = (child: CompiledFlow, cfg: FlowStepCfg = {}): StepSpec => ({
  ...base('flow', cfg, {
    childContext: cfg.context ?? (() => ({})),
    ...(cfg.output !== undefined ? { childOutput: cfg.output } : {}),
    ...(cfg.compensate !== undefined ? { compensate: cfg.compensate } : {}),
  }),
  child,
})

export const final = (cfg: FinalCfg = {}): StepSpec =>
  base('final', cfg, cfg.output !== undefined ? { finalOutput: cfg.output } : {})

// ---------------------------------------------------------------------------
// Flow builder
// ---------------------------------------------------------------------------

export interface FlowCfg {
  readonly name?: string
  readonly version?: number
  readonly start: string | readonly string[]
  readonly steps: Readonly<Record<string, StepSpec>>
  readonly policies?: Partial<CompiledFlow['policies']>
  readonly events?: Readonly<Record<string, RuntimeBoundary>>
}

export function flow(cfg: FlowCfg): CompiledFlow {
  const order = Object.keys(cfg.steps)
  const steps: Record<string, CompiledStep> = {}
  for (const id of order) steps[id] = { id, ...(cfg.steps[id] as StepSpec) }
  return {
    name: cfg.name ?? 'test',
    version: cfg.version ?? 1,
    context: trusted(),
    events: cfg.events ?? {},
    steps,
    order,
    start: typeof cfg.start === 'string' ? [cfg.start] : [...cfg.start],
    policies: {
      onFailure: 'halt',
      autoRun: 'ready',
      concurrency: Number.POSITIVE_INFINITY,
      unmatchedEvents: { buffer: true, ttlMs: 60_000 },
      ...cfg.policies,
    },
    identity: {},
  }
}

// ---------------------------------------------------------------------------
// Env + harness
// ---------------------------------------------------------------------------

export interface TestClock {
  now: number
  advance(ms: number): void
}

export function createEnv(
  def: CompiledFlow,
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
  readonly def: CompiledFlow
  state: WizardState
  /** Every event ever committed (all batches). */
  readonly log: DomainEvent[]
  /** Every effect ever planned. */
  readonly effects: Effect[]
  /** decide → apply-fold (envelopes assigned) → plan; records and returns the batch. */
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
  def: CompiledFlow,
  opts: { now?: number; context?: unknown; instanceId?: string; path?: readonly string[] } = {},
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
    }),
    log: [],
    effects: [],
    step(msg) {
      const bodies = machine.decide(env, h.state, msg)
      const events = envelope(env, h.state.seq, bodies)
      let s = h.state
      for (const ev of events) s = machine.apply(env, s, ev)
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
): DomainEvent[] {
  const at = env.now()
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
  })
  for (const ev of h.log) s = machine.apply(h.env, s, ev)
  return s
}

/** Event types of a batch (handy for `toEqual`). */
export const types = (r: BatchResult): readonly DomainEventType[] => r.types

/** Pick the events of one type from a batch. */
export function of<T extends DomainEventType>(
  r: BatchResult | readonly DomainEvent[],
  type: T,
): Extract<DomainEvent, { type: T }>[] {
  const list = Array.isArray(r) ? (r as readonly DomainEvent[]) : (r as BatchResult).events
  return list.filter((e): e is Extract<DomainEvent, { type: T }> => e.type === type)
}

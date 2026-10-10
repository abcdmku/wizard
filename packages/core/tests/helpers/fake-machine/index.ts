/**
 * Test doubles for the interpreter / façade / persistence suites.
 *
 * - `flow()` / `step()` build `CompiledFlow` literals with sensible defaults.
 * - `initialState` mirrors what the real machine's builder must produce.
 * - `createToyMachine()` is a small but real `Machine` (decide/apply/plan)
 *   covering start, next (with `canExit`), tasks (`run` + timeout), waits
 *   (`on` + timeout timers), inbox buffering, decisions-as-static-next,
 *   flow steps (child bridge), final, cancel, retry, reset, resume and
 *   `context.patch`. Every hook result goes through the real token check.
 *   Tests can override `decide` / `plan` per case to script edge cases.
 *
 * It is deliberately NOT the real machine (that lives in `src/machine/`, built
 * in parallel); it exists so queue semantics can be proven in isolation.
 */

import type {
  BoundaryResult,
  CompiledFlow,
  CompiledStep,
  RuntimeBoundary,
  StepKind,
} from '../../../src/authoring/compiled'
import type { Message } from '../../../src/machine/commands'
import type { Effect } from '../../../src/machine/effects'
import type { DomainEvent, DomainEventBody } from '../../../src/machine/events'
import type { StepRecord, WizardState } from '../../../src/machine/state'
import type { InitialState, Machine, MachineEnv } from '../../../src/machine/types'
import { toyApply } from './toy-apply'
import { toyDecide } from './toy-decide'
import { toyPlan } from './toy-plan'

// ---------------------------------------------------------------------------
// Boundaries
// ---------------------------------------------------------------------------

export const trusted: RuntimeBoundary = { kind: 'trusted', parse: (value) => ({ ok: true, value }) }

export function boundary(fn: (value: unknown) => BoundaryResult): RuntimeBoundary {
  return { kind: 'parse', parse: fn }
}

/** Accepts objects whose listed keys are strings; rejects everything else with issues. */
export function stringsBoundary(...keys: string[]): RuntimeBoundary {
  return boundary((value) => {
    if (typeof value !== 'object' || value === null)
      return { ok: false, issues: [{ message: 'expected an object' }] }
    const rec = value as Record<string, unknown>
    const issues = keys
      .filter((k) => typeof rec[k] !== 'string')
      .map((k) => ({ message: `${k} must be a string`, path: [k] }))
    return issues.length > 0 ? { ok: false, issues } : { ok: true, value: rec }
  })
}

// ---------------------------------------------------------------------------
// Compiled flow builders
// ---------------------------------------------------------------------------

export type StepSpec = Partial<Omit<CompiledStep, 'id' | 'kind'>> & { readonly kind: StepKind }

export function step(id: string, spec: StepSpec): CompiledStep {
  const { kind, ...rest } = spec
  return {
    id,
    kind,
    next: { kind: 'none' },
    hooks: {},
    expose: { input: kind === 'view', output: false },
    ...rest,
  }
}

export interface FlowSpec {
  readonly name?: string
  readonly version?: number
  readonly steps: Readonly<Record<string, StepSpec>>
  readonly start?: readonly string[]
  readonly events?: Readonly<Record<string, RuntimeBoundary>>
  readonly context?: RuntimeBoundary
  readonly policies?: Partial<CompiledFlow['policies']>
}

export function flow(spec: FlowSpec): CompiledFlow {
  const order = Object.keys(spec.steps)
  const steps: Record<string, CompiledStep> = {}
  for (const id of order) steps[id] = step(id, spec.steps[id]!)
  return {
    name: spec.name ?? 'test-flow',
    version: spec.version ?? 1,
    context: spec.context ?? trusted,
    events: spec.events ?? {},
    steps,
    order,
    start: spec.start ?? [order[0]!],
    policies: {
      onFailure: 'halt',
      autoRun: 'ready',
      concurrency: Number.POSITIVE_INFINITY,
      unmatchedEvents: { buffer: true, ttlMs: 60_000 },
      ...spec.policies,
    },
    identity: {},
  }
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialState: InitialState = (env, opts) => {
  const steps: Record<string, StepRecord> = {}
  for (const id of env.def.order) {
    steps[id] = {
      id,
      kind: env.def.steps[id]!.kind,
      status: 'idle',
      attempt: 0,
      runId: 0,
      guards: {},
      visitedCount: 0,
      pendingActivation: false,
    }
  }
  return {
    status: 'idle',
    current: null,
    active: [],
    context: opts.context,
    steps,
    history: [],
    nav: { phase: 'idle' },
    saga: { stack: [], compensated: [], failures: [] },
    inbox: [],
    timers: {},
    seq: 0,
    instanceId: opts.instanceId,
    epoch: opts.epoch ?? 0,
    flow: { name: env.def.name, version: env.def.version },
    startedAt: null,
    updatedAt: opts.now,
  }
}

export interface ToyOverrides {
  /** Return `undefined` to fall back to the toy's default decide. */
  readonly decide?: (
    env: MachineEnv,
    state: WizardState,
    msg: Message,
    base: () => readonly DomainEventBody[],
  ) => readonly DomainEventBody[] | undefined
  readonly plan?: (
    env: MachineEnv,
    state: WizardState,
    batch: readonly DomainEvent[],
    base: () => readonly Effect[],
  ) => readonly Effect[] | undefined
  readonly apply?: (
    env: MachineEnv,
    state: WizardState,
    event: DomainEvent,
    base: () => WizardState,
  ) => WizardState | undefined
}

export function createToyMachine(overrides: ToyOverrides = {}): Machine {
  const base: Machine = { decide: toyDecide, apply: toyApply, plan: toyPlan }
  return {
    decide: (env, state, msg) =>
      overrides.decide?.(env, state, msg, () => base.decide(env, state, msg)) ??
      base.decide(env, state, msg),
    apply: (env, state, event) =>
      overrides.apply?.(env, state, event, () => base.apply(env, state, event)) ??
      base.apply(env, state, event),
    plan: (env, state, batch) =>
      overrides.plan?.(env, state, batch, () => base.plan(env, state, batch)) ??
      base.plan(env, state, batch),
  }
}

/** A ready-to-use env for direct machine calls in tests. */
export function testEnv(
  def: CompiledFlow,
  now = 0,
): MachineEnv & { readonly tick: (ms: number) => void } {
  let t = now
  const counters = new Map<string, number>()
  return {
    def,
    path: [],
    now: () => t,
    id: (prefix) => {
      const n = (counters.get(prefix) ?? 0) + 1
      counters.set(prefix, n)
      return `${prefix}_${n}`
    },
    tick: (ms) => {
      t += ms
    },
  }
}

export function types(events: readonly DomainEvent[]): string[] {
  return events.map((e) => e.type)
}

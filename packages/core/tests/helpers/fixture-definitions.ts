/**
 * Compiled fixtures shared by machine, interpreter and runtime tests.
 *
 * - `flow({...})` plus ordinary, view, and child-flow helpers build `CompiledFlow`
 *   literals with tiny hooks (no authoring layer involved).
 */

import type {
  CompiledFlow,
  CompiledStep,
  EachSpec,
  ExposeSpec,
  FlowOnHandlerResult,
  Hook,
  NeedSpec,
  NextRef,
  OnHandlerResult,
  RetryPolicy,
  RuntimeBoundary,
  StepKind,
} from '../../src/authoring/compiled'

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
  readonly targets?: readonly string[]
  readonly needs?: Readonly<Record<string, NeedSpec>>
  readonly fallback?: string
  readonly canEnter?: Hook<boolean>
  readonly canExit?: Hook<boolean>
  readonly enter?: Hook<void>
  readonly exit?: Hook<void>
  readonly label?: string
  readonly expose?: ExposeSpec
  /** Skip predicate. */
  readonly when?: Hook<boolean>
  /** `on[event]` handlers on any kind (waits keep their own `on` field too). */
  readonly on?: Readonly<Record<string, Hook<OnHandlerResult>>>
}

export interface ViewCfg extends CommonCfg {
  readonly input?: RuntimeBoundary
  readonly initial?: unknown
  readonly validate?: CompiledStep['hooks']['validate']
}
export interface RunStepCfg extends CommonCfg {
  readonly run?: Hook<unknown>
  readonly output?: RuntimeBoundary
  readonly each?: EachSpec
  readonly sleep?: number | Hook<number>
  readonly retry?: RetryPolicy
  readonly timeoutMs?: number
  readonly compensate?: Hook<void>
  readonly mapError?: Hook<unknown>
  readonly idempotent?: boolean
  readonly idempotencyKey?: Hook<string>
}
export interface EventStepCfg extends CommonCfg {
  readonly on?: Readonly<Record<string, Hook<OnHandlerResult>>>
  readonly timeout?: { readonly afterMs: number; readonly next: string }
}
export interface RouteStepCfg extends CommonCfg {
  readonly decide?: Hook<NextRef>
}
export interface FlowStepCfg extends CommonCfg {
  readonly context?: Hook<unknown>
  readonly deps?: Hook<unknown>
  readonly each?: EachSpec
  readonly output?: Hook<unknown>
  readonly compensate?: Hook<void>
}
export interface CompleteStepCfg extends CommonCfg {
  readonly output?: Hook<unknown>
}

type StepSpec = Omit<CompiledStep, 'id'>

const noop: Hook<void> = () => undefined
const NO_EXPOSE: ExposeSpec = { input: true, output: false }

function nextOf(cfg: CommonCfg): CompiledStep['next'] {
  if (cfg.dynamicNext !== undefined)
    return { kind: 'dynamic', ...(cfg.targets !== undefined ? { targets: cfg.targets } : {}) }
  if (cfg.next === undefined || cfg.next === null) return { kind: 'none' }
  return { kind: 'static', targets: typeof cfg.next === 'string' ? [cfg.next] : [...cfg.next] }
}

/** One plain need per producer, keyed by its id: the consumer waits for every output. */
export const needAll = (...producers: string[]): Record<string, NeedSpec> =>
  Object.fromEntries(producers.map((id) => [id, { kind: 'all', steps: [id] }]))

/** One optional need per producer: the consumer waits for each to settle and runs if it skipped. */
export const needOptional = (...producers: string[]): Record<string, NeedSpec> =>
  Object.fromEntries(producers.map((id) => [id, { kind: 'optional', steps: [id] }]))

/** One `any` need: the consumer waits for the first producer that completes. */
export const needAny = (...producers: string[]): Record<string, NeedSpec> => ({
  first: { kind: 'any', steps: producers },
})

function base(
  kind: StepKind,
  cfg: CommonCfg,
  hooks: CompiledStep['hooks'],
  eventDriven = false,
): StepSpec {
  return {
    kind,
    next: nextOf(cfg),
    ...(cfg.needs !== undefined ? { needs: cfg.needs } : {}),
    ...(cfg.fallback !== undefined ? { fallback: cfg.fallback } : {}),
    ...(cfg.label !== undefined ? { label: cfg.label } : {}),
    hooks: {
      ...(cfg.canEnter !== undefined ? { canEnter: cfg.canEnter } : {}),
      ...(cfg.canExit !== undefined ? { canExit: cfg.canExit } : {}),
      ...(cfg.enter !== undefined ? { enter: cfg.enter } : {}),
      ...(cfg.exit !== undefined ? { exit: cfg.exit } : {}),
      ...(cfg.dynamicNext !== undefined ? { next: cfg.dynamicNext } : {}),
      ...(cfg.when !== undefined ? { when: cfg.when } : {}),
      ...(eventDriven || cfg.on !== undefined
        ? { [eventDriven ? 'waitFor' : 'on']: cfg.on ?? {} }
        : {}),
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

export const runStep = (cfg: RunStepCfg = {}): StepSpec => ({
  ...base('step', cfg, {
    ...(cfg.sleep === undefined ? { run: cfg.run ?? noop } : {}),
    ...(cfg.compensate !== undefined ? { compensate: cfg.compensate } : {}),
    ...(cfg.mapError !== undefined ? { mapError: cfg.mapError } : {}),
    ...(cfg.idempotencyKey !== undefined ? { idempotencyKey: cfg.idempotencyKey } : {}),
  }),
  ...(cfg.output !== undefined ? { output: cfg.output } : {}),
  ...(cfg.each !== undefined ? { each: cfg.each } : {}),
  ...(cfg.sleep !== undefined ? { sleep: cfg.sleep } : {}),
  ...(cfg.retry !== undefined ? { retry: cfg.retry } : {}),
  ...(cfg.timeoutMs !== undefined ? { timeoutMs: cfg.timeoutMs } : {}),
  ...(cfg.idempotent !== undefined ? { idempotent: cfg.idempotent } : {}),
})

export const eventStep = (cfg: EventStepCfg = {}): StepSpec => ({
  ...base('step', cfg, {}, true),
  ...(cfg.timeout !== undefined ? { waitTimeout: cfg.timeout } : {}),
})

/** A routing node with no hook can act as an ordinary terminal sink. */
export const routingStep = (cfg: RouteStepCfg = {}): StepSpec => {
  const dynamicNext = cfg.decide ?? cfg.dynamicNext
  return base('step', { ...cfg, ...(dynamicNext !== undefined ? { dynamicNext } : {}) }, {})
}

export const flowStep = (child: CompiledFlow, cfg: FlowStepCfg = {}): StepSpec => ({
  ...base('flow', cfg, {
    childContext: cfg.context ?? (() => ({})),
    ...(cfg.deps !== undefined ? { childDeps: cfg.deps } : {}),
    ...(cfg.output !== undefined ? { childOutput: cfg.output } : {}),
    ...(cfg.compensate !== undefined ? { compensate: cfg.compensate } : {}),
  }),
  child,
  ...(cfg.each !== undefined ? { each: cfg.each } : {}),
})

export const completeStepDef = (cfg: CompleteStepCfg = {}): StepSpec => ({
  ...base('step', cfg, cfg.output !== undefined ? { run: cfg.output } : {}),
})

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
  /** Flow-level `on[event]` handlers. */
  readonly on?: Readonly<Record<string, Hook<FlowOnHandlerResult>>>
  /** Correlation extractors. */
  readonly correlate?: Readonly<Record<string, (payload: unknown) => string | undefined>>
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
    ...(cfg.on !== undefined ? { on: cfg.on } : {}),
    ...(cfg.correlate !== undefined ? { correlate: cfg.correlate } : {}),
    steps,
    order,
    feeds: needFeeds(steps),
    sinks: sinksOf(steps),
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

/** Pull activation and sink output use the same edges as the compiler. */
export function needFeeds(steps: Readonly<Record<string, CompiledStep>>): CompiledFlow['feeds'] {
  const feeds: Record<string, string[]> = {}
  for (const [id, step] of Object.entries(steps)) {
    for (const need of Object.values(step.needs ?? {})) {
      for (const producer of need.steps) {
        const consumers = feeds[producer] ?? []
        feeds[producer] = consumers
        if (!consumers.includes(id)) consumers.push(id)
      }
    }
  }
  return feeds
}

export function sinksOf(steps: Readonly<Record<string, CompiledStep>>): readonly string[] {
  const needed = new Set(Object.keys(needFeeds(steps)))
  return Object.values(steps)
    .filter(
      (step) =>
        !needed.has(step.id) &&
        (step.next.kind === 'none' ||
          (step.next.kind === 'static' && step.next.targets.length === 0)),
    )
    .map((step) => step.id)
}

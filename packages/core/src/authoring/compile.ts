/**
 * `compile(flow)` — turns an inert `Flow` into the `CompiledFlow` the machine and the
 * interpreter consume, validating it on the way.
 *
 * Hard problems (thrown together as ONE `WizardError` listing ALL of them, nested flows
 * included): unknown ids in `next` / `dependsOn` / `timeout.next` / `start`, a `final` with
 * `next`, dependency cycles, a `wait` that can never complete (no handlers, no timeout), a
 * step-level or flow-level handler (`on`, `correlate`) for an undeclared event, fields a kind
 * does not accept (per-kind allow-lists, e.g. `input` on a task, `when` on a final), malformed
 * hooks/policies. The error code is `NESTING_CYCLE` (a flow embeds an ancestor) or
 * `NESTING_TOO_DEEP` (deeper than 8) when such a problem is among them, `DEFINITION_INVALID`
 * otherwise — nothing aborts on the first nested problem.
 *
 * v0.2: `on` compiles for every kind (`hooks.on`, results normalised per kind: `{ keep }` /
 * `{ next }` for waits, `{ next }` for views, `void` elsewhere — anything else is a `TypeError`
 * at delivery time, i.e. the step fails `kind: 'hook'`); `when` → `hooks.when`; a task's
 * `idempotent` → `idempotent: true` (+ `hooks.idempotencyKey` for the function form) and
 * `mapError` → `hooks.mapError` (called with `(args.error, args)`); the definition header's
 * `on` / `correlate` → `def.on` / `def.correlate`.
 *
 * Warnings (never thrown; `compile(flow, { onWarning })`, reused by `inspect()`):
 * `UNREACHABLE` (no path from `start`), `NEVER_ACTIVATES` (`dependsOn` but no incoming edge),
 * `NAV_CYCLE` (a cycle through static `next` / `timeout.next` edges — allowed, reported).
 * Dynamic `next` functions may target any step, so a reachable dynamic step silences the
 * reachability analysis.
 *
 * Flow-step mappers (`context`, `deps`) are compiled RAW: the executor / child bridge parse
 * their values through the child's boundaries exactly once, at child creation.
 *
 * Results are cached per `Flow` object (`defineFlow().steps()` compiles eagerly, so
 * `createWizard` never compiles twice).
 *
 * @packageDocumentation
 */

import { WizardError } from '../errors'
import { isBoundary, toRuntimeBoundary } from './boundary'
import type {
  CompiledFlow,
  CompiledStep,
  DepsSpec,
  FlowOnHandlerResult,
  Hook,
  MaybePromise,
  NextRef,
  OnHandlerResult,
  RetryPolicy,
  RuntimeBoundary,
} from './compiled'
import { parseDuration } from './duration'
import type { AnyFlow, AnyStep, Duration, Issue, StepKind } from './types'

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

/**
 * A static-analysis warning about a flow (advisory; never thrown).
 * @public
 */
export interface FlowWarning {
  readonly code: 'UNREACHABLE' | 'NEVER_ACTIVATES' | 'NAV_CYCLE'
  readonly message: string
  /** Step the warning is about. */
  readonly step?: string
  /** Wizard path of the flow the step belongs to (`[]` = root). */
  readonly path: readonly string[]
}

/**
 * `compile()` options.
 * @public
 */
export interface CompileOptions {
  readonly onWarning?: (warning: FlowWarning) => void
}

/** @internal Cached result of analysing one flow object. */
export interface Analysis {
  readonly compiled: CompiledFlow
  readonly warnings: readonly FlowWarning[]
}

/** Maximum nesting depth (path length of the deepest child); mirrors the child bridge. */
export const MAX_DEPTH = 8

const KINDS: ReadonlySet<string> = new Set<StepKind>([
  'view',
  'task',
  'wait',
  'decision',
  'flow',
  'final',
])
const DEFAULT_TTL_MS = 300_000
const NO_EXPOSE: CompiledStep['expose'] = { input: false, output: false }

/**
 * Per-field kind allow-list (mirrors the `*Cfg` types; `label` / `dependsOn` / `on` are
 * accepted by every kind, `next` by every kind but `final`, which has its own message). A field
 * set on a step of another kind is a definition problem: `only view steps accept 'input' (kind
 * 'task')`.
 */
const FIELD_KINDS: Readonly<Record<string, readonly StepKind[]>> = {
  input: ['view'],
  initial: ['view'],
  validate: ['view'],
  canEnter: ['view'],
  canExit: ['view'],
  enter: ['view', 'task', 'wait'],
  exit: ['view', 'task', 'wait', 'flow'],
  when: ['view', 'task', 'wait', 'decision', 'flow'],
  run: ['task'],
  output: ['task', 'flow', 'final'],
  retry: ['task'],
  timeout: ['task', 'wait'],
  compensate: ['task'],
  idempotent: ['task'],
  mapError: ['task'],
  child: ['flow'],
  context: ['flow'],
  deps: ['flow'],
}

const cache = new WeakMap<object, Analysis>()

/**
 * Compile (and validate) a flow. Throws `WizardError('DEFINITION_INVALID' | 'NESTING_CYCLE' |
 * 'NESTING_TOO_DEEP')` listing every problem; reports warnings through `options.onWarning`.
 * Cached per flow object.
 * @public
 */
export function compile(flow: AnyFlow, options: CompileOptions = {}): CompiledFlow {
  const analysis = analyze(flow)
  if (options.onWarning !== undefined) for (const w of analysis.warnings) options.onWarning(w)
  return analysis.compiled
}

/** @internal Compile + warnings, cached per flow object. */
export function analyze(flow: AnyFlow): Analysis {
  const cached = cache.get(flow)
  if (cached !== undefined) return cached
  const problems: string[] = []
  const warnings: FlowWarning[] = []
  const nesting: NestingProblem[] = []
  const compiled = compileFlow(flow, { problems, warnings, nesting, path: [], chain: [flow] })
  if (problems.length > 0) {
    const worst = nesting[0]
    throw new WizardError(
      worst?.code ?? 'DEFINITION_INVALID',
      `flow '${describeName(flow)}' is invalid:\n- ${problems.join('\n- ')}`,
      {
        issues: problems.map((message) => ({ message })),
        ...(worst !== undefined ? { step: worst.step } : {}),
      },
    )
  }
  const analysis: Analysis = { compiled, warnings }
  cache.set(flow, analysis)
  return analysis
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

interface NestingProblem {
  readonly code: 'NESTING_CYCLE' | 'NESTING_TOO_DEEP'
  readonly step: string
}

interface Ctx {
  readonly problems: string[]
  readonly warnings: FlowWarning[]
  /** Nesting problems (also listed in `problems`); the first one decides the error code. */
  readonly nesting: NestingProblem[]
  /** Wizard path of the flow being compiled. */
  readonly path: readonly string[]
  /** Flow objects currently being compiled (ancestors, nearest last). */
  readonly chain: readonly object[]
}

type Rec = Record<string, unknown>

function compileFlow(flow: AnyFlow, ctx: Ctx): CompiledFlow {
  const at = ctx.path.length === 0 ? '' : `${ctx.path.join('/')}: `
  const problem = (message: string): void => {
    ctx.problems.push(at + message)
  }
  if (!isRecord(flow)) {
    problem('flow must be an object')
    return emptyFlow(flow)
  }
  const name = typeof flow.name === 'string' && flow.name.length > 0 ? flow.name : undefined
  if (name === undefined) problem("'name' must be a non-empty string")
  const version = flow.version === undefined ? 1 : flow.version
  if (!(Number.isInteger(version) && version >= 0))
    problem("'version' must be a non-negative integer")

  // Null-prototype maps: `def.events[name]` / `def.steps[id]` for a name that is not declared is
  // `undefined` even for `constructor` / `toString` / `__proto__` (untrusted ids reach these lookups).
  const events: Record<string, RuntimeBoundary> = Object.create(null)
  if (flow.events !== undefined) {
    if (!isRecord(flow.events)) problem("'events' must be an object of boundaries")
    else {
      for (const [event, b] of Object.entries(flow.events)) {
        if (isBoundary(b)) events[event] = toRuntimeBoundary(b)
        else problem(`events['${event}'] must be a boundary`)
      }
    }
  }
  const context = isBoundary(flow.context) ? toRuntimeBoundary(flow.context) : undefined
  if (context === undefined) problem("'context' must be a boundary")
  const deps =
    flow.deps === undefined
      ? undefined
      : isBoundary(flow.deps)
        ? toRuntimeBoundary(flow.deps)
        : undefined
  if (flow.deps !== undefined && deps === undefined) problem("'deps' must be a boundary")

  const eventNames = new Set(Object.keys(events))
  const on = compileFlowOn(flow.on, eventNames, problem)
  const correlate = compileCorrelate(flow.correlate, eventNames, problem)

  const rawSteps = isRecord(flow.steps) ? flow.steps : undefined
  if (rawSteps === undefined) problem("'steps' must be an object")
  const order = rawSteps === undefined ? [] : Object.keys(rawSteps)
  if (order.length === 0) problem('flow has no steps')
  const ids = new Set(order)

  const steps: Record<string, CompiledStep> = Object.create(null)
  const graph = new StepGraph(order)
  for (const id of order) {
    const raw = rawSteps?.[id]
    if (!isStepRecord(raw)) {
      problem(
        `steps['${id}'] is not a step (build steps with s.view/task/wait/decision/flow/final)`,
      )
      continue
    }
    steps[id] = compileStep(id, raw, { ctx, problem, ids, events: eventNames, graph })
  }

  let start: readonly string[]
  const rawStart: unknown = flow.start
  if (rawStart === undefined) start = order.length > 0 ? [order[0] as string] : []
  else if (typeof rawStart === 'string') {
    if (!ids.has(rawStart)) problem(`start: unknown step '${rawStart}'`)
    start = [rawStart]
  } else if (Array.isArray(rawStart) && rawStart.every((s: unknown) => typeof s === 'string')) {
    for (const s of rawStart as string[]) if (!ids.has(s)) problem(`start: unknown step '${s}'`)
    start = [...(rawStart as string[])]
  } else {
    problem("'start' must be a step id")
    start = []
  }

  for (const cycle of graph.dependencyCycles()) {
    problem(`dependency cycle: ${cycle.join(' -> ')}`)
  }
  graph.warnUnreachable(start, ctx.path, ctx.warnings)
  graph.warnNavigationCycles(ctx.path, ctx.warnings)

  return {
    name: name ?? '',
    version: typeof version === 'number' ? version : 1,
    context: context ?? trustedBoundary(),
    ...(deps !== undefined ? { deps } : {}),
    events,
    ...(on !== undefined ? { on } : {}),
    ...(correlate !== undefined ? { correlate } : {}),
    steps,
    order,
    start,
    policies: compilePolicies(flow, problem),
    identity: flow,
  }
}

/** `defineFlow({ on })` → `def.on`: handlers keyed by DECLARED events, results normalised to `{ cancel? }`. */
function compileFlowOn(
  raw: unknown,
  events: ReadonlySet<string>,
  problem: (m: string) => void,
): CompiledFlow['on'] {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    problem("'on' must be an object of functions keyed by event name")
    return undefined
  }
  const handlers: Record<string, Hook<FlowOnHandlerResult>> = Object.create(null)
  for (const [event, handler] of Object.entries(raw)) {
    if (handler === undefined) continue
    if (typeof handler !== 'function') {
      problem(`on['${event}'] must be a function`)
      continue
    }
    if (!events.has(event)) problem(`on['${event}']: the flow declares no event '${event}'`)
    handlers[event] = (args) =>
      chain((handler as Hook)(args), (result): FlowOnHandlerResult => {
        if (result === undefined || result === null) return undefined
        if (!isRecord(result) || typeof result.cancel !== 'string') {
          throw new TypeError('a flow-level on handler must return void or { cancel: reason }')
        }
        return { cancel: result.cancel }
      })
  }
  return handlers
}

/**
 * `defineFlow({ correlate })` → `def.correlate`: extractors keyed by DECLARED events. A
 * non-string result is `undefined` (no correlation for that payload) — nothing here throws.
 */
function compileCorrelate(
  raw: unknown,
  events: ReadonlySet<string>,
  problem: (m: string) => void,
): CompiledFlow['correlate'] {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    problem("'correlate' must be an object of functions keyed by event name")
    return undefined
  }
  const extractors: Record<string, (payload: unknown) => string | undefined> = Object.create(null)
  for (const [event, fn] of Object.entries(raw)) {
    if (fn === undefined) continue
    if (typeof fn !== 'function') {
      problem(`correlate['${event}'] must be a function`)
      continue
    }
    if (!events.has(event)) problem(`correlate['${event}']: the flow declares no event '${event}'`)
    const extract = fn as (payload: unknown) => unknown
    extractors[event] = (payload) => {
      const id = extract(payload)
      return typeof id === 'string' ? id : undefined
    }
  }
  return extractors
}

function compilePolicies(flow: Rec, problem: (m: string) => void): CompiledFlow['policies'] {
  const onFailure = flow.onFailure === undefined ? 'halt' : flow.onFailure
  if (onFailure !== 'halt' && onFailure !== 'compensate')
    problem("onFailure must be 'halt' | 'compensate'")
  const autoRun = flow.autoRun === undefined ? 'ready' : flow.autoRun
  if (autoRun !== 'ready' && autoRun !== 'manual') problem("autoRun must be 'ready' | 'manual'")
  const concurrency = flow.concurrency === undefined ? Number.POSITIVE_INFINITY : flow.concurrency
  if (typeof concurrency !== 'number' || Number.isNaN(concurrency) || concurrency < 1) {
    problem('concurrency must be a number >= 1')
  }
  let unmatchedEvents: CompiledFlow['policies']['unmatchedEvents'] = {
    buffer: true,
    ttlMs: DEFAULT_TTL_MS,
  }
  if (flow.unmatchedEvents !== undefined) {
    const u = flow.unmatchedEvents
    if (!isRecord(u) || typeof u.buffer !== 'boolean')
      problem('unmatchedEvents must be { buffer, ttl }')
    else {
      const ttlMs =
        u.ttl === undefined ? DEFAULT_TTL_MS : durationMs(u.ttl, 'unmatchedEvents.ttl', problem)
      unmatchedEvents = { buffer: u.buffer, ttlMs: ttlMs ?? DEFAULT_TTL_MS }
    }
  }
  const retry = flow.retry === undefined ? undefined : compileRetry(flow.retry, 'retry', problem)
  return {
    onFailure: onFailure === 'compensate' ? 'compensate' : 'halt',
    ...(retry !== undefined ? { retry } : {}),
    autoRun: autoRun === 'manual' ? 'manual' : 'ready',
    concurrency:
      typeof concurrency === 'number' && concurrency >= 1 ? concurrency : Number.POSITIVE_INFINITY,
    unmatchedEvents,
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

interface StepCtx {
  readonly ctx: Ctx
  readonly problem: (message: string) => void
  readonly ids: ReadonlySet<string>
  readonly events: ReadonlySet<string>
  readonly graph: StepGraph
}

function compileStep(id: string, s: AnyStep, sc: StepCtx): CompiledStep {
  const problem = (message: string): void => sc.problem(`step '${id}': ${message}`)
  const kind = s.kind
  const hooks: Mutable<CompiledStep['hooks']> = {}
  const step: Mutable<CompiledStep> = { id, kind, next: { kind: 'none' }, hooks, expose: NO_EXPOSE }

  if (s.label !== undefined) {
    if (typeof s.label === 'string') step.label = s.label
    else problem("'label' must be a string")
  }

  // next ---------------------------------------------------------------------
  const next = s.next
  if (typeof next === 'function') {
    step.next = { kind: 'dynamic' }
    hooks.next = asHook<NextRef>(next)
    sc.graph.dynamic(id)
  } else if (typeof next === 'string' || Array.isArray(next)) {
    const targets = typeof next === 'string' ? [next] : [...(next as unknown[])]
    for (const t of targets) {
      if (typeof t !== 'string')
        problem("'next' must be a step id, an array of ids, null or a function")
      else if (!sc.ids.has(t)) problem(`next: unknown step '${t}'`)
    }
    const valid = targets.filter((t): t is string => typeof t === 'string')
    step.next = { kind: 'static', targets: valid }
    sc.graph.edges(id, valid)
  } else if (next !== undefined && next !== null) {
    problem("'next' must be a step id, an array of ids, null or a function")
  }
  if (kind === 'final' && next !== undefined && next !== null)
    problem('a final step cannot have next')
  if (kind === 'decision' && typeof next !== 'function')
    problem("a decision needs a 'next' function")

  // dependsOn ----------------------------------------------------------------
  const deps = s.dependsOn
  if (deps !== undefined) {
    const spec = toDepsSpec(deps)
    if (spec === undefined) problem("'dependsOn' must be an array of ids or { any: ids }")
    else {
      const list = 'all' in spec ? spec.all : spec.any
      for (const d of list) if (!sc.ids.has(d)) problem(`dependsOn: unknown step '${d}'`)
      step.dependsOn = spec
      sc.graph.dependsOn(id, list)
    }
  }

  // per-kind allow-list ---------------------------------------------------------
  const rec = s as unknown as Rec
  const accepts = (field: string): boolean => {
    const kinds = FIELD_KINDS[field]
    return kinds === undefined || kinds.includes(kind)
  }
  for (const [field, kinds] of Object.entries(FIELD_KINDS)) {
    if (rec[field] !== undefined && !kinds.includes(kind)) {
      problem(`only ${kinds.join('/')} steps accept '${field}' (kind '${kind}')`)
    }
  }

  // shared hooks (only where the kind accepts them) -----------------------------------
  if (accepts('canEnter'))
    hookField(s.canEnter, 'canEnter', problem, (h) => (hooks.canEnter = asHook<boolean>(h)))
  if (accepts('canExit'))
    hookField(s.canExit, 'canExit', problem, (h) => (hooks.canExit = asHook<boolean>(h)))
  if (accepts('enter')) hookField(s.enter, 'enter', problem, (h) => (hooks.enter = asHook<void>(h)))
  if (accepts('exit')) hookField(s.exit, 'exit', problem, (h) => (hooks.exit = asHook<void>(h)))
  if (accepts('when')) hookField(s.when, 'when', problem, (h) => (hooks.when = asHook<boolean>(h)))

  // `on` — any kind (v0.2); a wait additionally REQUIRES it (checked below) -------------------
  const on = s.on
  if (on !== undefined || kind === 'wait') {
    const handlers: Record<string, Hook<OnHandlerResult>> = {}
    if (!isRecord(on)) {
      problem(
        kind === 'wait'
          ? "a wait needs an 'on' object of event handlers"
          : "'on' must be an object of event handlers",
      )
    } else {
      for (const [event, handler] of Object.entries(on)) {
        if (handler === undefined) continue
        if (typeof handler !== 'function') {
          problem(`on['${event}'] must be a function`)
          continue
        }
        if (!sc.events.has(event)) problem(`on['${event}']: the flow declares no event '${event}'`)
        handlers[event] = wrapOnHandler(handler as (a: never) => unknown, sc.ids, kind)
      }
    }
    hooks.on = handlers
  }

  switch (kind) {
    case 'view': {
      if (s.input !== undefined) {
        if (isBoundary(s.input)) step.input = toRuntimeBoundary(s.input)
        else problem("'input' must be a boundary")
      }
      if (s.initial !== undefined) step.initial = s.initial
      hookField(s.validate, 'validate', problem, (h) => {
        // The pipeline hands the parsed value in as `input`; the DSL calls it `output`.
        hooks.validate = (args) =>
          (h as Hook<void | readonly Issue[]>)({ ...args, output: args.input })
      })
      break
    }
    case 'task': {
      if (typeof s.run !== 'function') problem("a task needs a 'run' function")
      else hooks.run = asHook<unknown>(s.run)
      if (s.output !== undefined) {
        if (isBoundary(s.output)) step.output = toRuntimeBoundary(s.output)
        else problem("'output' must be a boundary")
      }
      if (s.retry !== undefined) {
        const retry = compileRetry(s.retry, 'retry', problem)
        if (retry !== undefined) step.retry = retry
      }
      if (s.timeout !== undefined) {
        const ms = durationMs(s.timeout, 'timeout', problem)
        if (ms !== undefined) step.timeoutMs = ms
      }
      hookField(s.compensate, 'compensate', problem, (h) => {
        hooks.compensate = (args) =>
          (h as Hook<void>)({ ...args, reason: args.reason ?? undefined })
      })
      const idempotent = s.idempotent
      if (idempotent !== undefined) {
        if (idempotent === true) step.idempotent = true
        else if (typeof idempotent === 'function') {
          step.idempotent = true
          hooks.idempotencyKey = (args) =>
            chain((idempotent as Hook)(args), (key): string => {
              if (typeof key !== 'string' || key.length === 0) {
                throw new TypeError('an idempotency key function must return a non-empty string')
              }
              return key
            })
        } else if (idempotent !== false) {
          problem("'idempotent' must be true, false or a function returning the key")
        }
      }
      hookField(s.mapError, 'mapError', problem, (h) => {
        // The DSL signature is `(error, args)`; the runtime hands the raw error in as `args.error`.
        const mapError = h as unknown as (error: unknown, args: unknown) => unknown
        hooks.mapError = (args) => mapError(args.error, args)
      })
      break
    }
    case 'wait': {
      const timeout = s.timeout
      if (timeout !== undefined) {
        if (!isRecord(timeout) || typeof timeout.next !== 'string') {
          problem("'timeout' must be { after: Duration, next: stepId }")
        } else {
          const afterMs = durationMs(timeout.after as Duration, 'timeout.after', problem)
          if (!sc.ids.has(timeout.next)) problem(`timeout.next: unknown step '${timeout.next}'`)
          if (afterMs !== undefined) {
            step.waitTimeout = { afterMs, next: timeout.next }
            sc.graph.timeout(id, timeout.next)
          }
        }
      }
      if (Object.keys(hooks.on ?? {}).length === 0 && step.waitTimeout === undefined) {
        problem('a wait with no handlers and no timeout can never complete')
      }
      break
    }
    case 'decision':
      break
    case 'flow': {
      const child = s.child
      if (!isRecord(child) || !isRecord(child.steps))
        problem('a flow step needs a child flow (s.flow(child, cfg))')
      else {
        const childFlow = child as unknown as AnyFlow
        const childPath = [...sc.ctx.path, id]
        // Nesting problems are collected like any other (the first decides the error code);
        // the child is not compiled, everything else still is.
        if (sc.ctx.chain.includes(childFlow)) {
          sc.ctx.nesting.push({ code: 'NESTING_CYCLE', step: id })
          sc.problem(
            `flow '${describeName(childFlow)}' embeds one of its ancestors (at step '${id}')`,
          )
        } else if (childPath.length > MAX_DEPTH) {
          sc.ctx.nesting.push({ code: 'NESTING_TOO_DEEP', step: id })
          sc.problem(`flow nesting deeper than ${MAX_DEPTH} at '${childPath.join('/')}'`)
        } else {
          step.child = compileFlow(childFlow, {
            problems: sc.ctx.problems,
            warnings: sc.ctx.warnings,
            nesting: sc.ctx.nesting,
            path: childPath,
            chain: [...sc.ctx.chain, childFlow],
          })
        }
        // RAW mappers: the executor parses `context` through the child's context boundary and
        // the child bridge parses `deps` through the child's deps boundary — once each, at creation.
        if (typeof s.context !== 'function') problem("a flow step needs a 'context' function")
        else hooks.childContext = asHook<unknown>(s.context)
        hookField(s.deps, 'deps', problem, (h) => (hooks.childDeps = asHook<unknown>(h)))
        if (s.output !== undefined) {
          if (!isBoundary(s.output)) problem("'output' must be a boundary")
          else {
            const boundary = toRuntimeBoundary(s.output)
            step.output = boundary
            hooks.childOutput = (args) =>
              chain(boundary.parse(args.output), (r) => unwrap(r, `output of '${id}'`))
          }
        }
      }
      break
    }
    case 'final': {
      hookField(s.output, 'output', problem, (h) => (hooks.finalOutput = asHook<unknown>(h)))
      break
    }
    default:
      problem(`unknown kind '${String(kind)}'`)
  }

  return step
}

// ---------------------------------------------------------------------------
// Hook adapters
// ---------------------------------------------------------------------------

/** User hooks are typed against `HookArgs`-compatible arg objects; the runtime passes `HookArgs`. */
function asHook<R>(fn: (a: never) => unknown): Hook<R> {
  return fn as unknown as Hook<R>
}

function hookField(
  value: unknown,
  name: string,
  problem: (m: string) => void,
  set: (fn: (a: never) => unknown) => void,
): void {
  if (value === undefined) return
  if (typeof value !== 'function') {
    problem(`'${name}' must be a function`)
    return
  }
  set(value as (a: never) => unknown)
}

/**
 * Normalise a step-level `on` handler's result to the machine's contract, per kind: a wait may
 * return `{ keep: true }` or `{ next }` (a single id), a view `{ next }`, every other kind
 * nothing. Anything else is a `TypeError` (the step fails `kind: 'hook'`).
 */
function wrapOnHandler(
  handler: (a: never) => unknown,
  ids: ReadonlySet<string>,
  kind: StepKind,
): Hook<OnHandlerResult> {
  const contract =
    kind === 'wait'
      ? 'void, { keep: true } or { next?: stepId }'
      : kind === 'view'
        ? 'void or { next?: stepId }'
        : 'void'
  return (args) =>
    chain((handler as Hook)(args), (result): OnHandlerResult => {
      if (result === undefined || result === null) return undefined
      if (!isRecord(result) || (kind !== 'wait' && kind !== 'view')) {
        throw new TypeError(`a ${kind} step's on handler must return ${contract}`)
      }
      if (kind === 'wait' && result.keep === true) return { keep: true }
      const next = result.next
      if (next === undefined || next === null) return undefined
      if (typeof next !== 'string' || !ids.has(next)) {
        throw new TypeError(`${kind} handler returned an unknown next target '${String(next)}'`)
      }
      return { next }
    })
}

/** Unwrap a `BoundaryResult`; a rejection throws a coded error (the step fails with `kind: 'hook'`). */
function unwrap(result: unknown, what: string): unknown {
  if (isRecord(result) && result.ok === true) return result.value
  const issues = isRecord(result) && Array.isArray(result.issues) ? result.issues : []
  const detail = issues
    .map((i: unknown) => (isRecord(i) && typeof i.message === 'string' ? i.message : String(i)))
    .join('; ')
  const error = Object.assign(
    new Error(`${what} rejected by boundary${detail.length > 0 ? `: ${detail}` : ''}`),
    { code: 'BOUNDARY_REJECTED', issues },
  )
  error.name = 'BoundaryError'
  throw error
}

function chain<T, R>(value: MaybePromise<T>, then: (v: T) => R): MaybePromise<R> {
  return isThenable(value) ? (value.then(then) as Promise<R>) : then(value as T)
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  )
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

function durationMs(
  value: unknown,
  what: string,
  problem: (m: string) => void,
): number | undefined {
  try {
    return parseDuration(value as Duration)
  } catch (error) {
    problem(`${what}: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

/**
 * Validate a `RetryPolicy` — one shape shared by the DSL and the machine, so nothing is mapped:
 * `attempts` a non-negative integer; `backoff` a fixed number of ms or `'exponential'`;
 * `baseMs` / `factor` / `maxBackoffMs` only with `'exponential'` (defaults are applied by the
 * machine: 200 ms / 2 / 30 s). Returns a copy holding only the recognised fields.
 */
export function compileRetry(
  policy: unknown,
  what: string,
  problem: (m: string) => void,
): RetryPolicy | undefined {
  if (!isRecord(policy)) {
    problem(`${what} must be { attempts, backoff?, baseMs?, factor?, maxBackoffMs? }`)
    return undefined
  }
  const { attempts, backoff, baseMs, factor, maxBackoffMs } = policy
  if (typeof attempts !== 'number' || !Number.isInteger(attempts) || attempts < 0) {
    problem(`${what}.attempts must be a non-negative integer`)
    return undefined
  }
  const out: Mutable<RetryPolicy> = { attempts }
  if (backoff !== undefined) {
    if (backoff === 'exponential') out.backoff = 'exponential'
    else if (typeof backoff === 'number' && Number.isFinite(backoff) && backoff >= 0)
      out.backoff = backoff
    else problem(`${what}.backoff must be a number of ms >= 0 or 'exponential'`)
  }
  const exponential = backoff === 'exponential'
  const tuning: ReadonlyArray<readonly [key: 'baseMs' | 'factor' | 'maxBackoffMs', v: unknown]> = [
    ['baseMs', baseMs],
    ['factor', factor],
    ['maxBackoffMs', maxBackoffMs],
  ]
  for (const [key, value] of tuning) {
    if (value === undefined) continue
    if (!exponential) {
      problem(`${what}.${key} only applies to backoff: 'exponential'`)
    } else if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < (key === 'factor' ? 1 : 0)
    ) {
      problem(`${what}.${key} must be a number >= ${key === 'factor' ? 1 : 0}`)
    } else out[key] = value
  }
  return out
}

function toDepsSpec(deps: unknown): DepsSpec | undefined {
  if (Array.isArray(deps) && deps.every((d) => typeof d === 'string'))
    return { all: [...(deps as string[])] }
  if (
    isRecord(deps) &&
    Array.isArray(deps.any) &&
    deps.any.every((d: unknown) => typeof d === 'string')
  ) {
    return { any: [...(deps.any as string[])] }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Graph analysis (cycles, reachability)
// ---------------------------------------------------------------------------

class StepGraph {
  private readonly nextEdges = new Map<string, Set<string>>()
  private readonly depEdges = new Map<string, readonly string[]>()
  private readonly dynamicSteps = new Set<string>()

  constructor(private readonly ids: readonly string[]) {}

  edges(from: string, to: readonly string[]): void {
    let set = this.nextEdges.get(from)
    if (set === undefined) {
      set = new Set()
      this.nextEdges.set(from, set)
    }
    for (const t of to) set.add(t)
  }
  timeout(from: string, to: string): void {
    this.edges(from, [to])
  }
  dynamic(step: string): void {
    this.dynamicSteps.add(step)
  }
  dependsOn(step: string, deps: readonly string[]): void {
    this.depEdges.set(step, deps)
  }

  /** Simple cycles over `dependsOn` edges (each reported once, in discovery order). */
  dependencyCycles(): readonly (readonly string[])[] {
    return findCycles(this.ids, (id) =>
      (this.depEdges.get(id) ?? []).filter((d) => this.depEdges.has(d) || d === id),
    )
  }

  /** Cycles through static `next` / `timeout.next` edges: allowed (loops), reported as advice. */
  warnNavigationCycles(path: readonly string[], out: FlowWarning[]): void {
    for (const cycle of findCycles(this.ids, (id) => [...(this.nextEdges.get(id) ?? [])])) {
      out.push({
        code: 'NAV_CYCLE',
        message: `navigation cycle: ${cycle.join(' -> ')} (allowed; make sure a guard, a decision or a wait breaks it)`,
        step: cycle[0] as string,
        path,
      })
    }
  }

  /** Steps with no path from `start` (a reachable dynamic-`next` step may reach anything). */
  warnUnreachable(start: readonly string[], path: readonly string[], out: FlowWarning[]): void {
    const reached = new Set<string>()
    const queue = start.filter((s) => this.ids.includes(s))
    for (const s of queue) reached.add(s)
    while (queue.length > 0) {
      const id = queue.shift() as string
      if (this.dynamicSteps.has(id)) {
        for (const t of this.ids) if (!reached.has(t)) reached.add(t)
        break
      }
      for (const t of this.nextEdges.get(id) ?? []) {
        if (!reached.has(t)) {
          reached.add(t)
          queue.push(t)
        }
      }
    }
    for (const id of this.ids) {
      if (reached.has(id)) continue
      const gated = this.depEdges.has(id)
      out.push({
        code: gated ? 'NEVER_ACTIVATES' : 'UNREACHABLE',
        message: gated
          ? `step '${id}' declares dependsOn but has no incoming next/start edge, so it can never activate`
          : `step '${id}' is not reachable from start`,
        step: id,
        path,
      })
    }
  }
}

/** Simple cycles of a directed graph (each reported once, in discovery order). */
function findCycles(
  ids: readonly string[],
  edgesOf: (id: string) => readonly string[],
): readonly (readonly string[])[] {
  const cycles: string[][] = []
  const seen = new Set<string>()
  const visiting: string[] = []
  const onStack = new Set<string>()
  const visit = (id: string): void => {
    if (onStack.has(id)) {
      const cycle = visiting.slice(visiting.indexOf(id))
      cycle.push(id)
      const key = [...cycle].sort().join(' ')
      if (!cycles.some((c) => [...c].sort().join(' ') === key)) cycles.push(cycle)
      return
    }
    if (seen.has(id)) return
    seen.add(id)
    onStack.add(id)
    visiting.push(id)
    for (const next of edgesOf(id)) visit(next)
    visiting.pop()
    onStack.delete(id)
  }
  for (const id of ids) visit(id)
  return cycles
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStepRecord(value: unknown): value is AnyStep {
  return isRecord(value) && typeof value.kind === 'string' && KINDS.has(value.kind)
}

function describeName(flow: unknown): string {
  return isRecord(flow) && typeof flow.name === 'string' ? flow.name : '<unnamed>'
}

function trustedBoundary(): RuntimeBoundary {
  return { kind: 'trusted', parse: (value) => ({ ok: true, value }) }
}

function emptyFlow(identity: unknown): CompiledFlow {
  return {
    name: '',
    version: 1,
    context: trustedBoundary(),
    events: {},
    steps: {},
    order: [],
    start: [],
    policies: {
      onFailure: 'halt',
      autoRun: 'ready',
      concurrency: Number.POSITIVE_INFINITY,
      unmatchedEvents: { buffer: true, ttlMs: DEFAULT_TTL_MS },
    },
    identity: typeof identity === 'object' && identity !== null ? identity : {},
  }
}

/**
 * Compile one step: `next` / `dependsOn`, the per-kind field allow-list, the shared hooks
 * (`canEnter` / `canExit` / `enter` / `exit` / `when` / `on`) and the kind-specific fields.
 * @internal
 */

import { isBoundary, toRuntimeBoundary } from '../boundary'
import type { CompiledStep, Hook, NextRef, OnHandlerResult } from '../compiled'
import type { AnyFlow, AnyStep, Duration, Issue, StepKind } from '../types'
import { type Ctx, compileFlow } from './flow'
import type { StepGraph } from './graph'
import { asHook, chain, hookField, unwrap } from './hooks'
import { compileRetry, durationMs, toDepsSpec } from './policies'
import { describeName, isRecord, MAX_DEPTH, type Mutable, NO_EXPOSE, type Rec } from './shared'

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

export interface StepCtx {
  readonly ctx: Ctx
  readonly problem: (message: string) => void
  readonly ids: ReadonlySet<string>
  readonly events: ReadonlySet<string>
  readonly graph: StepGraph
}

type Problem = (message: string) => void
type Build = Mutable<CompiledStep>
type Hooks = Mutable<CompiledStep['hooks']>

export function compileStep(id: string, s: AnyStep, sc: StepCtx): CompiledStep {
  const problem: Problem = (message) => sc.problem(`step '${id}': ${message}`)
  const kind = s.kind
  const hooks: Hooks = {}
  const step: Build = { id, kind, next: { kind: 'none' }, hooks, expose: NO_EXPOSE }

  if (s.label !== undefined) {
    if (typeof s.label === 'string') step.label = s.label
    else problem("'label' must be a string")
  }
  compileNext(id, s, step, hooks, problem, sc)
  compileDependsOn(id, s, step, problem, sc)
  // per-kind allow-list: a field set on a step of another kind is a definition problem.
  const rec = s as unknown as Rec
  for (const [field, kinds] of Object.entries(FIELD_KINDS)) {
    if (rec[field] !== undefined && !kinds.includes(kind)) {
      problem(`only ${kinds.join('/')} steps accept '${field}' (kind '${kind}')`)
    }
  }
  compileSharedHooks(s, hooks, problem)
  compileOn(s, hooks, problem, sc)
  switch (kind) {
    case 'view':
      compileView(s, step, hooks, problem)
      break
    case 'task':
      compileTask(s, step, hooks, problem)
      break
    case 'wait':
      compileWait(id, s, step, hooks, problem, sc)
      break
    case 'decision':
      break
    case 'flow':
      compileFlowStep(id, s, step, hooks, problem, sc)
      break
    case 'final':
      hookField(s.output, 'output', problem, (h) => (hooks.finalOutput = asHook<unknown>(h)))
      break
    default:
      problem(`unknown kind '${String(kind)}'`)
  }
  return step
}

/** `next`: a step id, a list of ids (fan-out), `null` or a function (dynamic). */
function compileNext(
  id: string,
  s: AnyStep,
  step: Build,
  hooks: Hooks,
  problem: Problem,
  sc: StepCtx,
): void {
  const kind = s.kind
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
}

function compileDependsOn(
  id: string,
  s: AnyStep,
  step: Build,
  problem: Problem,
  sc: StepCtx,
): void {
  const deps = s.dependsOn
  if (deps === undefined) return
  const spec = toDepsSpec(deps)
  if (spec === undefined) {
    problem("'dependsOn' must be an array of ids or { any: ids }")
    return
  }
  const list = 'all' in spec ? spec.all : spec.any
  for (const d of list) if (!sc.ids.has(d)) problem(`dependsOn: unknown step '${d}'`)
  step.dependsOn = spec
  sc.graph.dependsOn(id, list)
}

/** `canEnter` / `canExit` / `enter` / `exit` / `when` — only where the kind accepts them. */
function compileSharedHooks(s: AnyStep, hooks: Hooks, problem: Problem): void {
  const accepts = (field: string): boolean => {
    const kinds = FIELD_KINDS[field]
    return kinds === undefined || kinds.includes(s.kind)
  }
  if (accepts('canEnter'))
    hookField(s.canEnter, 'canEnter', problem, (h) => (hooks.canEnter = asHook<boolean>(h)))
  if (accepts('canExit'))
    hookField(s.canExit, 'canExit', problem, (h) => (hooks.canExit = asHook<boolean>(h)))
  if (accepts('enter')) hookField(s.enter, 'enter', problem, (h) => (hooks.enter = asHook<void>(h)))
  if (accepts('exit')) hookField(s.exit, 'exit', problem, (h) => (hooks.exit = asHook<void>(h)))
  if (accepts('when')) hookField(s.when, 'when', problem, (h) => (hooks.when = asHook<boolean>(h)))
}

/** `on` — any kind (v0.2); a wait additionally REQUIRES it (checked in `compileWait`). */
function compileOn(s: AnyStep, hooks: Hooks, problem: Problem, sc: StepCtx): void {
  const on = s.on
  if (on === undefined && s.kind !== 'wait') return
  const handlers: Record<string, Hook<OnHandlerResult>> = {}
  if (!isRecord(on)) {
    problem(
      s.kind === 'wait'
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
      // RAW: the machine applies the per-kind result contract (`machine/wait.ts`).
      handlers[event] = asHook<OnHandlerResult>(handler as (a: never) => unknown)
    }
  }
  hooks.on = handlers
}

function compileView(s: AnyStep, step: Build, hooks: Hooks, problem: Problem): void {
  if (s.input !== undefined) {
    if (isBoundary(s.input)) step.input = toRuntimeBoundary(s.input)
    else problem("'input' must be a boundary")
  }
  if (s.initial !== undefined) step.initial = s.initial
  hookField(s.validate, 'validate', problem, (h) => {
    // The pipeline hands the parsed value in as `input`; the DSL calls it `output`.
    hooks.validate = (args) => (h as Hook<void | readonly Issue[]>)({ ...args, output: args.input })
  })
}

function compileTask(s: AnyStep, step: Build, hooks: Hooks, problem: Problem): void {
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
    hooks.compensate = (args) => (h as Hook<void>)({ ...args, reason: args.reason ?? undefined })
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
}

function compileWait(
  id: string,
  s: AnyStep,
  step: Build,
  hooks: Hooks,
  problem: Problem,
  sc: StepCtx,
): void {
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
}

/** A flow step: nesting guards, the child compiled recursively, RAW `context` / `deps` mappers, `output` boundary. */
function compileFlowStep(
  id: string,
  s: AnyStep,
  step: Build,
  hooks: Hooks,
  problem: Problem,
  sc: StepCtx,
): void {
  const child = s.child
  if (!isRecord(child) || !isRecord(child.steps)) {
    problem('a flow step needs a child flow (s.flow(child, cfg))')
    return
  }
  const childFlow = child as unknown as AnyFlow
  const childPath = [...sc.ctx.path, id]
  // Nesting problems are collected like any other (the first decides the error code);
  // the child is not compiled, everything else still is.
  if (sc.ctx.chain.includes(childFlow)) {
    sc.ctx.nesting.push({ code: 'NESTING_CYCLE', step: id })
    sc.problem(`flow '${describeName(childFlow)}' embeds one of its ancestors (at step '${id}')`)
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

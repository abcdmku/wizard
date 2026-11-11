/**
 * Compile one flow: header (name, version, boundaries, flow-level `on` / `correlate`, policies),
 * its steps (through `compileStep`) and the graph analysis (dependency cycles as problems,
 * reachability / navigation cycles as warnings).
 * @internal
 */

import { isBoundary, toRuntimeBoundary } from '../boundary'
import type {
  CompiledFlow,
  CompiledStep,
  FlowOnHandlerResult,
  Hook,
  RuntimeBoundary,
} from '../compiled'
import type { AnyFlow } from '../types'
import { StepGraph } from './graph'
import { chain } from './hooks'
import type { FlowWarning } from './index'
import { compileRetry, durationMs } from './policies'
import {
  compileProse,
  DEFAULT_TTL_MS,
  isRecord,
  isStepRecord,
  type Rec,
  trustedBoundary,
} from './shared'
import { compileStep } from './steps'

export interface NestingProblem {
  readonly code: 'NESTING_CYCLE' | 'NESTING_TOO_DEEP'
  readonly step: string
}

export interface Ctx {
  readonly problems: string[]
  readonly warnings: FlowWarning[]
  /** Nesting problems (also listed in `problems`); the first one decides the error code. */
  readonly nesting: NestingProblem[]
  /** Run path of the flow being compiled. */
  readonly path: readonly string[]
  /** Flow objects currently being compiled (ancestors, nearest last). */
  readonly chain: readonly object[]
}

export function compileFlow(flow: AnyFlow, ctx: Ctx): CompiledFlow {
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
      problem(`steps['${id}'] is not a step (build steps with step(), view(), or flow())`)
      continue
    }
    steps[id] = compileStep(id, raw, {
      ctx,
      problem,
      ids,
      events: eventNames,
      graph,
    })
  }
  if (flow.output !== undefined) {
    if (typeof flow.output !== 'function') problem("'output' must be a synchronous function")
  }
  let start: readonly string[]
  const rawStart: unknown = flow.start
  if (rawStart === undefined) start = order.length > 0 ? [order[0] as string] : []
  else if (typeof rawStart === 'string') {
    if (!ids.has(rawStart)) problem(`start: unknown step '${rawStart}'`)
    start = [rawStart]
  } else if (Array.isArray(rawStart) && rawStart.every((s: unknown) => typeof s === 'string')) {
    if (rawStart.length === 0) problem('start must contain at least one step')
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

  const feeds: Record<string, string[]> = Object.create(null)
  for (const consumer of order) {
    for (const need of Object.values(steps[consumer]?.needs ?? {})) {
      for (const producer of need.steps) {
        const consumers = feeds[producer] ?? []
        feeds[producer] = consumers
        if (!consumers.includes(consumer)) consumers.push(consumer)
      }
    }
  }
  // Fallback and timeout destinations are alternate edges. Happy-path outputs remain sinks.
  const sinks = order.filter((id) => steps[id]?.next.kind === 'none' && feeds[id] === undefined)
  if (flow.output === undefined && sinks.length !== 1)
    ctx.warnings.push({
      code: sinks.length === 0 ? 'NO_SINKS' : 'MULTIPLE_SINKS',
      message:
        sinks.length === 0
          ? 'wizard has no static sink; provide an output selector to define its result'
          : `wizard has multiple sinks (${sinks.join(', ')}); its output is the last completed sink, so provide an output selector for a stable result`,
      path: ctx.path,
    })
  const prose: { description?: string; meta?: NonNullable<CompiledFlow['meta']> } = {}
  compileProse(flow as unknown as Rec, prose, problem)

  return {
    ...(typeof flow.output === 'function'
      ? { output: flow.output as NonNullable<CompiledFlow['output']> }
      : {}),
    name: name ?? '',
    version: typeof version === 'number' ? version : 1,
    ...prose,
    context: context ?? trustedBoundary(),
    ...(deps !== undefined ? { deps } : {}),
    ...(flow.providedDeps !== undefined
      ? { providedDeps: flow.providedDeps as Readonly<Record<string, unknown>> }
      : {}),
    events,
    ...(on !== undefined ? { on } : {}),
    ...(correlate !== undefined ? { correlate } : {}),
    steps,
    order,
    start,
    feeds,
    sinks,
    policies: compilePolicies(flow, problem),
    identity: flow,
  }
}

/** Definition-level event handlers, with a closed cancel result contract. */
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
 * Correlation extractors keyed by declared events. A
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

function emptyFlow(identity: unknown): CompiledFlow {
  return {
    name: '',
    version: 1,
    context: trustedBoundary(),
    events: {},
    steps: {},
    order: [],
    start: [],
    feeds: {},
    sinks: [],
    policies: {
      onFailure: 'halt',
      autoRun: 'ready',
      concurrency: Number.POSITIVE_INFINITY,
      unmatchedEvents: { buffer: true, ttlMs: DEFAULT_TTL_MS },
    },
    identity: typeof identity === 'object' && identity !== null ? identity : {},
  }
}

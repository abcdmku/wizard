/**
 * OpenTelemetry tracing for an OpenWizard `FlowRun`.
 *
 * The adapter deliberately depends on the event stream rather than on core runtime internals.
 * This keeps the integration optional and means that a tracer can never change workflow
 * behaviour: errors from the telemetry implementation are reported to `onError` and ignored.
 * @packageDocumentation
 */

import {
  type Attributes,
  type Context,
  context,
  createContextKey,
  isSpanContextValid,
  type Link,
  propagation,
  type Span,
  type SpanContext,
  SpanKind,
  type SpanOptions,
  SpanStatusCode,
  type Tracer,
  trace,
} from '@opentelemetry/api'
import type { AnyFlow, EventType, FlowRun, RunEvent, SendResult } from '@openwizard/core'

const INSTRUMENTATION_NAME = '@openwizard/opentelemetry'
const INSTRUMENTATION_VERSION = '0.0.0'
const WORKFLOW_SPAN = 'openwizard.workflow'
const TASK_SPAN = 'openwizard.task'
const COMPENSATION_SPAN = 'openwizard.compensation'

const EXTERNAL_CONTEXT_KEY = createContextKey('openwizard external event context')

const LIFECYCLE_EVENTS = new Set([
  'flow.started',
  'flow.done',
  'flow.failed',
  'flow.compensating',
  'flow.compensated',
  'flow.cancelled',
  'flow.resumed',
  'flow.reset',
  'flow.status',
  'step.runStarted',
  'step.runSucceeded',
  'step.runFailed',
  'step.retryScheduled',
  'step.cancelled',
  'step.compensationStarted',
  'step.compensated',
  'step.compensationFailed',
  'event.received',
  'event.rejected',
  'event.delivered',
  'event.buffered',
  'event.expired',
  'event.dropped',
  'event.flowDelivered',
  'event.handlerResultIgnored',
  'event.handlerFailed',
  'child.started',
  'child.summary',
])

type InstanceIdOption = 'raw' | 'none' | ((id: string) => string | undefined)

/** Options for `instrumentRun`. @public */
export interface InstrumentRunOptions {
  /** Tracer to use. Defaults to `trace.getTracer('@openwizard/opentelemetry')`. */
  readonly tracer?: Tracer
  /** Context used as the parent of the root workflow span. */
  readonly parentContext?: Context
  /** Context (or span context) from an earlier process/epoch. It becomes a span link. */
  readonly resumeContext?: Context | SpanContext
  /** Trace child flows observed through this run. Defaults to `true`. */
  readonly children?: boolean
  /** Event detail recorded on workflow spans. Defaults to `'lifecycle'`. */
  readonly recordEvents?: 'none' | 'lifecycle' | 'all'
  /** Controls whether the instance identifier is put on spans. Defaults to `'raw'`. */
  readonly instanceId?: InstanceIdOption
  /** Called for adapter/tracer errors. It is never called for workflow errors. */
  readonly onError?: (error: unknown) => void
  /** Set successful spans to `OK`; by default only failures set a status. */
  readonly successStatus?: boolean
}

/** Options for the instrumentation `send` convenience method. @public */
export interface ExternalSendOptions {
  /** The workflow's normal correlation id, if the caller needs to supply one. */
  readonly correlationId?: string
  /** Extracted request/message context to link to `event.received`. */
  readonly context?: Context
}

/** Handle returned by `instrumentRun`. @public */
export interface RunInstrumentation<F extends AnyFlow> {
  /** Stop observing and finish open spans. Calling this more than once is safe. */
  stop(): void
  /** Return the workflow/task span for a path, if it has been created. */
  span(path?: readonly string[]): Span | undefined
  /** Return a context containing the span for a path, if it has been created. */
  context(path?: readonly string[]): Context | undefined
  /** Inject the selected workflow span context into a carrier. */
  inject(carrier: Record<string, string>, path?: readonly string[]): void
  /** Extract a propagation context from a carrier. */
  extract(carrier: Record<string, string>, base?: Context): Context
  /** Run a callback with an incoming context marked as an external-event context. */
  withExternalContext<T>(incoming: Context, fn: () => T): T
  /** Send an external event and optionally associate its incoming trace context. */
  send<E extends EventType<F>>(
    event: E,
    payload: unknown,
    options?: ExternalSendOptions,
  ): Promise<SendResult>
}

interface EventRecord {
  readonly type: string
  readonly path?: readonly string[]
  readonly seq?: number
  readonly at?: number
  readonly causedBy?: number
  readonly [key: string]: unknown
}

interface FlowRecord {
  readonly path: readonly string[]
  readonly span: Span
  readonly spanContext: Context
  ended: boolean
}

interface AttemptRecord {
  readonly key: string
  readonly path: readonly string[]
  readonly step: string
  readonly runId: number
  readonly attempt: number
  readonly span: Span
  readonly spanContext: Context
  closed: boolean
}

interface CompensationRecord {
  readonly key: string
  readonly path: readonly string[]
  readonly step: string
  readonly runId?: number
  readonly span: Span
  closed: boolean
}

interface CompletedAttempt {
  readonly path: readonly string[]
  readonly step: string
  readonly runId: number
  readonly spanContext: SpanContext
}

interface PendingExternal {
  readonly event: string
  readonly spanContext: SpanContext
}

type Outcome = 'success' | 'error' | 'cancelled' | 'detached' | 'reset' | 'interrupted'

const pathKey = (path: readonly string[]): string => JSON.stringify(path)

const asEvent = <F extends AnyFlow>(event: RunEvent<F>): EventRecord =>
  event as unknown as EventRecord

const asPath = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) return []
  return value.filter((segment): segment is string => typeof segment === 'string')
}

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const isContext = (value: Context | SpanContext): value is Context =>
  typeof value === 'object' && value !== null && 'getValue' in value

const spanContextOf = (value: Context | SpanContext | undefined): SpanContext | undefined => {
  if (!value) return undefined
  const candidate = isContext(value) ? trace.getSpanContext(value) : value
  return candidate && isSpanContextValid(candidate) ? candidate : undefined
}

const safeOutcome = (value: unknown): 'failed' | 'cancelled' | undefined => {
  if (value === 'failed' || value === 'cancelled') return value
  return undefined
}

/**
 * Attach OpenTelemetry workflow, task-attempt, compensation, and nested-flow spans to a run.
 *
 * Only stable identifiers, event names, counters, paths, and boolean outcomes are exported.
 * Payloads, outputs, input/context patches, inbox/correlation values, idempotency keys, and
 * error messages are intentionally never copied to spans.
 * @public
 */
export function instrumentRun<F extends AnyFlow>(
  run: FlowRun<F>,
  options: InstrumentRunOptions = {},
): RunInstrumentation<F> {
  const tracer = options.tracer ?? trace.getTracer(INSTRUMENTATION_NAME, INSTRUMENTATION_VERSION)
  const includeChildren = options.children !== false
  const recordEvents = options.recordEvents ?? 'lifecycle'
  const report = (error: unknown): void => {
    try {
      options.onError?.(error)
    } catch {
      // An observer must not be able to affect a workflow because its error handler failed.
    }
  }

  const flowRecords = new Map<string, FlowRecord>()
  const attempts = new Map<string, AttemptRecord>()
  const compensations = new Map<string, CompensationRecord>()
  const completed = new Map<string, CompletedAttempt>()
  const pendingExternal: PendingExternal[] = []
  let stopped = false
  let observing = true
  let detachFromRun: (() => void) | undefined
  let stoppingFromRunDispose = false
  let externalContextOverride: Context | undefined

  const instanceAttribute = (id: string): string | undefined => {
    const choice = options.instanceId ?? 'raw'
    if (choice === 'none') return undefined
    if (choice === 'raw') return id
    try {
      return choice(id)
    } catch (error) {
      report(error)
      return undefined
    }
  }

  const runAt = (path: readonly string[]): FlowRun<AnyFlow> | undefined => {
    let current = run as unknown as FlowRun<AnyFlow>
    for (const segment of path) {
      try {
        const child = current.child as unknown as (step: string) => FlowRun<AnyFlow>
        current = child(segment)
      } catch {
        return undefined
      }
    }
    return current
  }

  const flowAttributes = (path: readonly string[], source: FlowRun<AnyFlow>): Attributes => {
    const version = source.flow.version ?? 1
    const attributes: Attributes = {
      'openwizard.flow.name': source.flow.name,
      'openwizard.flow.version': version,
      'openwizard.path': [...path],
      'openwizard.epoch': source.epoch,
    }
    const instanceId = instanceAttribute(source.id)
    if (instanceId !== undefined) attributes['openwizard.instance.id'] = instanceId
    return attributes
  }

  const eventAttributes = (event: EventRecord): Attributes => {
    const attributes: Attributes = { 'openwizard.event.type': event.type }
    if (event.seq !== undefined) attributes['openwizard.event.seq'] = event.seq
    if (event.causedBy !== undefined) attributes['openwizard.event.caused_by'] = event.causedBy
    if (event.at !== undefined) attributes['openwizard.event.logical_time_ms'] = event.at
    attributes['openwizard.event.path'] = [...asPath(event.path)]
    if ('correlationId' in event) attributes['openwizard.event.has_correlation_id'] = true
    return attributes
  }

  const parentContextFor = (path: readonly string[]): Context => {
    if (path.length === 0) return options.parentContext ?? context.active()
    const parent = flowRecords.get(pathKey(path.slice(0, -1)))
    return parent?.spanContext ?? options.parentContext ?? context.active()
  }

  const addLink = (span: Span, spanContext: SpanContext, type: string): void => {
    try {
      const link: Link = {
        context: spanContext,
        attributes: { 'openwizard.link.type': type },
      }
      span.addLink(link)
    } catch (error) {
      report(error)
    }
  }

  const setAttribute = (span: Span, key: string, value: string | number | boolean): void => {
    try {
      span.setAttribute(key, value)
    } catch (error) {
      report(error)
    }
  }

  const endSpan = (span: Span, outcome: Outcome): void => {
    try {
      span.setAttribute('openwizard.outcome', outcome)
      if (outcome === 'error') {
        span.setStatus({ code: SpanStatusCode.ERROR })
      } else if (outcome === 'success' && options.successStatus) {
        span.setStatus({ code: SpanStatusCode.OK })
      }
      span.end()
    } catch (error) {
      report(error)
    }
  }

  const closeAttempt = (attempt: AttemptRecord, outcome: Outcome): void => {
    if (attempt.closed) return
    attempt.closed = true
    setAttribute(attempt.span, 'openwizard.task.outcome', outcome)
    endSpan(attempt.span, outcome)
    attempts.delete(attempt.key)
    if (outcome === 'success') {
      const spanContext = attempt.span.spanContext()
      if (isSpanContextValid(spanContext)) {
        completed.set(`${pathKey(attempt.path)}\u0000${attempt.step}\u0000${attempt.runId}`, {
          path: attempt.path,
          step: attempt.step,
          runId: attempt.runId,
          spanContext,
        })
      }
    }
  }

  const closeCompensation = (compensation: CompensationRecord, outcome: Outcome): void => {
    if (compensation.closed) return
    compensation.closed = true
    setAttribute(compensation.span, 'openwizard.compensation.outcome', outcome)
    endSpan(compensation.span, outcome)
    compensations.delete(compensation.key)
  }

  const stateFor = (path: readonly string[]): FlowRecord | undefined => {
    if (!includeChildren && path.length > 0) return undefined
    const effectivePath = includeChildren ? path : []
    return flowRecords.get(pathKey(effectivePath))
  }

  const ensureFlow = (path: readonly string[]): FlowRecord | undefined => {
    const effectivePath = includeChildren ? [...path] : []
    const key = pathKey(effectivePath)
    const existing = flowRecords.get(key)
    if (existing && !existing.ended) return existing

    if (effectivePath.length > 0) ensureFlow(effectivePath.slice(0, -1))
    const source = runAt(effectivePath) ?? (run as unknown as FlowRun<AnyFlow>)
    const parent = parentContextFor(effectivePath)
    const links: Link[] = []
    if (existing) {
      const previous = existing.span.spanContext()
      if (isSpanContextValid(previous)) {
        links.push({
          context: previous,
          attributes: { 'openwizard.link.type': 'continuation' },
        })
      }
    } else if (effectivePath.length === 0) {
      const resumed = spanContextOf(options.resumeContext)
      if (resumed) {
        links.push({ context: resumed, attributes: { 'openwizard.link.type': 'resume' } })
      }
    }

    const spanOptions: SpanOptions = {
      kind: SpanKind.INTERNAL,
      attributes: {
        ...flowAttributes(effectivePath, source),
        ...(options.resumeContext !== undefined || source.epoch > 0
          ? { 'openwizard.resumed': true }
          : {}),
      },
      ...(links.length > 0 ? { links } : {}),
    }
    try {
      const span = tracer.startSpan(WORKFLOW_SPAN, spanOptions, parent)
      const spanContext = trace.setSpan(parent, span)
      const record: FlowRecord = {
        path: effectivePath,
        span,
        spanContext,
        ended: false,
      }
      flowRecords.set(key, record)
      return record
    } catch (error) {
      report(error)
      return undefined
    }
  }

  const isUnderPath = (candidate: readonly string[], parent: readonly string[]): boolean =>
    candidate.length >= parent.length &&
    parent.every((segment, index) => candidate[index] === segment)

  const closePath = (path: readonly string[], outcome: Outcome): void => {
    const effectivePath = includeChildren ? path : []
    for (const attempt of [...attempts.values()]) {
      const attemptPath = includeChildren ? attempt.path : []
      if (isUnderPath(attemptPath, effectivePath)) closeAttempt(attempt, outcome)
    }
    for (const compensation of [...compensations.values()]) {
      const compensationPath = includeChildren ? compensation.path : []
      if (isUnderPath(compensationPath, effectivePath)) closeCompensation(compensation, outcome)
    }
    for (const record of flowRecords.values()) {
      if (isUnderPath(record.path, effectivePath) && !record.ended) {
        record.ended = true
        setAttribute(record.span, 'openwizard.flow.outcome', outcome)
        endSpan(record.span, outcome)
      }
    }
  }

  const taskParent = (path: readonly string[]): FlowRecord | undefined =>
    stateFor(path) ?? ensureFlow(path)

  const taskKey = (path: readonly string[], step: string): string => `${pathKey(path)}\u0000${step}`

  const startAttempt = (event: EventRecord, path: readonly string[], step: string): void => {
    const flow = taskParent(path)
    if (!flow) return
    const attemptNumber = asNumber(event.attempt) ?? 0
    const runId = asNumber(event.runId) ?? 0
    const key = taskKey(path, step)
    const previous = attempts.get(key)
    if (previous) closeAttempt(previous, 'interrupted')

    const attributes: Attributes = {
      ...flowAttributes(path, runAt(path) ?? (run as unknown as FlowRun<AnyFlow>)),
      'openwizard.step': step,
      'openwizard.step.kind': 'task',
      'openwizard.task.attempt': attemptNumber,
      'openwizard.task.retry': attemptNumber > 1,
      'openwizard.task.retry_count': Math.max(0, attemptNumber - 1),
      'openwizard.task.run_id': runId,
    }
    attributes['openwizard.task.resumed'] = event.resumed === true
    try {
      const span = tracer.startSpan(
        TASK_SPAN,
        { kind: SpanKind.INTERNAL, attributes },
        flow.spanContext,
      )
      attempts.set(key, {
        key,
        path: [...path],
        step,
        runId,
        attempt: attemptNumber,
        span,
        spanContext: trace.setSpan(flow.spanContext, span),
        closed: false,
      })
    } catch (error) {
      report(error)
    }
  }

  const finishAttempt = (
    event: EventRecord,
    path: readonly string[],
    step: string,
    outcome: Outcome,
  ): void => {
    const attempt = attempts.get(taskKey(path, step))
    if (!attempt) return
    const expected = asNumber(event.attempt)
    if (expected !== undefined && expected !== attempt.attempt) return
    if (outcome === 'error') {
      setAttribute(
        attempt.span,
        'openwizard.error.kind',
        event.timedOut === true ? 'timeout' : 'task',
      )
      if (typeof event.willRetry === 'boolean')
        setAttribute(attempt.span, 'openwizard.task.will_retry', event.willRetry)
    }
    closeAttempt(attempt, outcome)
  }

  const completedFor = (
    path: readonly string[],
    step: string,
    runId: number | undefined,
  ): CompletedAttempt | undefined => {
    if (runId !== undefined) return completed.get(`${pathKey(path)}\u0000${step}\u0000${runId}`)
    const prefix = `${pathKey(path)}\u0000${step}\u0000`
    const values = [...completed.entries()].filter(([key]) => key.startsWith(prefix))
    return values.at(-1)?.[1]
  }

  const compensationKey = (
    path: readonly string[],
    step: string,
    runId: number | undefined,
  ): string => `${pathKey(path)}\u0000${step}\u0000${runId ?? 'unknown'}`

  const startCompensation = (event: EventRecord, path: readonly string[], step: string): void => {
    const flow = taskParent(path)
    if (!flow) return
    const runId = asNumber(event.runId)
    const key = compensationKey(path, step, runId)
    const previous = compensations.get(key)
    if (previous) closeCompensation(previous, 'interrupted')
    const completedAttempt = completedFor(path, step, runId)
    const links: Link[] = []
    if (completedAttempt) {
      links.push({
        context: completedAttempt.spanContext,
        attributes: { 'openwizard.link.type': 'compensation' },
      })
    }
    const attributes: Attributes = {
      ...flowAttributes(path, runAt(path) ?? (run as unknown as FlowRun<AnyFlow>)),
      'openwizard.step': step,
      'openwizard.compensation': true,
      ...(runId !== undefined ? { 'openwizard.compensation.run_id': runId } : {}),
    }
    try {
      const span = tracer.startSpan(
        COMPENSATION_SPAN,
        {
          kind: SpanKind.INTERNAL,
          attributes,
          ...(links.length > 0 ? { links } : {}),
        },
        flow.spanContext,
      )
      compensations.set(key, {
        key,
        path: [...path],
        step,
        ...(runId !== undefined ? { runId } : {}),
        span,
        closed: false,
      })
    } catch (error) {
      report(error)
    }
  }

  const finishCompensation = (
    event: EventRecord,
    path: readonly string[],
    step: string,
    outcome: Outcome,
  ): void => {
    const runId = asNumber(event.runId)
    const exact = compensations.get(compensationKey(path, step, runId))
    const compensation =
      exact ??
      [...compensations.values()]
        .reverse()
        .find((candidate) => pathKey(candidate.path) === pathKey(path) && candidate.step === step)
    if (!compensation) return
    if (outcome === 'error')
      setAttribute(compensation.span, 'openwizard.error.kind', 'compensation')
    setAttribute(compensation.span, 'openwizard.compensation.outcome', outcome)
    closeCompensation(compensation, outcome)
  }

  const takeExternal = (event: string): SpanContext | undefined => {
    const index = pendingExternal.findIndex((pending) => pending.event === event)
    if (index < 0) return undefined
    return pendingExternal.splice(index, 1)[0]?.spanContext
  }

  const externalContextFromActive = (): SpanContext | undefined => {
    const active = context.active()
    if (active.getValue(EXTERNAL_CONTEXT_KEY) !== true) return undefined
    return spanContextOf(active)
  }

  const recordEvent = (record: FlowRecord | undefined, event: EventRecord): void => {
    if (!record) return
    const shouldRecord =
      recordEvents !== 'none' && (recordEvents === 'all' || LIFECYCLE_EVENTS.has(event.type))
    const attributes: Attributes = shouldRecord ? eventAttributes(event) : {}
    if (event.type === 'event.received') {
      const incoming =
        takeExternal(asString(event.event) ?? '') ??
        spanContextOf(externalContextOverride) ??
        externalContextFromActive()
      if (incoming) {
        addLink(record.span, incoming, 'external-event')
        attributes['openwizard.external.context_linked'] = true
      }
      attributes['openwizard.external'] = true
    }
    if (!shouldRecord) return
    try {
      record.span.addEvent(`openwizard.${event.type}`, attributes)
    } catch (error) {
      report(error)
    }
  }

  const processEvent = (incomingEvent: RunEvent<F>): void => {
    if (stopped) return
    const event = asEvent(incomingEvent)
    const path = asPath(event.path)
    const record = ensureFlow(path)
    recordEvent(record, event)
    const step = asString(event.step)

    switch (event.type) {
      case 'flow.resumed':
        if (record) {
          const fromSeq = asNumber(event.fromSeq)
          const interrupted = Array.isArray(event.interrupted) ? event.interrupted.length : 0
          if (fromSeq !== undefined)
            setAttribute(record.span, 'openwizard.resume.from_seq', fromSeq)
          setAttribute(record.span, 'openwizard.resume.interrupted_count', interrupted)
        }
        break
      case 'step.runStarted':
        if (step) startAttempt(event, path, step)
        break
      case 'step.runSucceeded':
        if (step) finishAttempt(event, path, step, 'success')
        break
      case 'step.runFailed':
        if (step) finishAttempt(event, path, step, 'error')
        break
      case 'step.cancelled':
        if (step) finishAttempt(event, path, step, 'cancelled')
        break
      case 'step.compensationStarted':
        if (step) startCompensation(event, path, step)
        break
      case 'step.compensated':
        if (step) finishCompensation(event, path, step, 'success')
        break
      case 'step.compensationFailed':
        if (step) finishCompensation(event, path, step, 'error')
        break
      case 'flow.done':
        closePath(path, 'success')
        break
      case 'flow.failed':
        if (record && typeof event.code === 'string')
          setAttribute(record.span, 'openwizard.flow.error_code', event.code)
        closePath(path, 'error')
        break
      case 'flow.cancelled':
        closePath(path, 'cancelled')
        break
      case 'flow.compensated':
        closePath(path, safeOutcome(event.outcome) === 'failed' ? 'error' : 'cancelled')
        break
      case 'flow.reset':
        closePath(path, 'reset')
        for (const attempt of [...attempts.values()]) {
          const attemptPath = includeChildren ? attempt.path : []
          if (isUnderPath(attemptPath, includeChildren ? path : [])) attempts.delete(attempt.key)
        }
        for (const item of [...completed.entries()]) {
          const completedPath = includeChildren ? item[1].path : []
          if (isUnderPath(completedPath, includeChildren ? path : [])) completed.delete(item[0])
        }
        break
      default:
        break
    }
  }

  const stop = (): void => {
    if (stopped) return
    stopped = true
    observing = false
    try {
      unsubscribe?.()
    } catch (error) {
      report(error)
    }
    for (const attempt of [...attempts.values()]) closeAttempt(attempt, 'detached')
    for (const compensation of [...compensations.values()])
      closeCompensation(compensation, 'detached')
    for (const record of [...flowRecords.values()].reverse()) {
      if (!record.ended) {
        record.ended = true
        endSpan(record.span, 'detached')
      }
    }
    attempts.clear()
    compensations.clear()
    completed.clear()
    pendingExternal.length = 0
    if (!stoppingFromRunDispose) {
      const detach = detachFromRun
      detachFromRun = undefined
      try {
        detach?.()
      } catch (error) {
        report(error)
      }
    }
  }

  const observeEvent = (event: RunEvent<F>): void => {
    try {
      processEvent(event)
    } catch (error) {
      report(error)
    }
  }

  let unsubscribe: (() => void) | undefined
  const api: RunInstrumentation<F> = {
    stop,
    span(path = []): Span | undefined {
      const record = stateFor(path)
      return record?.span
    },
    context(path = []): Context | undefined {
      const record = stateFor(path)
      return record?.spanContext
    },
    inject(carrier, path = []): void {
      try {
        const spanContext = api.context(path)
        propagation.inject(spanContext ?? context.active(), carrier)
      } catch (error) {
        report(error)
      }
    },
    extract(carrier, base = context.active()): Context {
      try {
        return propagation.extract(base, carrier)
      } catch (error) {
        report(error)
        return base
      }
    },
    withExternalContext<T>(incoming: Context, fn: () => T): T {
      const marked = incoming.setValue(EXTERNAL_CONTEXT_KEY, true)
      const previous = externalContextOverride
      externalContextOverride = marked
      try {
        return context.with(marked, fn)
      } finally {
        externalContextOverride = previous
      }
    },
    send<E extends EventType<F>>(
      event: E,
      payload: unknown,
      sendOptions?: ExternalSendOptions,
    ): Promise<SendResult> {
      const active = context.active()
      const incoming =
        sendOptions?.context ??
        externalContextOverride ??
        (active.getValue(EXTERNAL_CONTEXT_KEY) === true ? active : undefined)
      const incomingSpan = spanContextOf(incoming)
      if (incomingSpan) pendingExternal.push({ event: String(event), spanContext: incomingSpan })
      const coreOptions =
        sendOptions?.correlationId === undefined
          ? undefined
          : { correlationId: sendOptions.correlationId }
      let result: Promise<SendResult>
      try {
        const invoke = (): Promise<SendResult> => run.send(event, payload, coreOptions)
        if (sendOptions?.context) {
          const marked = sendOptions.context.setValue(EXTERNAL_CONTEXT_KEY, true)
          result = context.with(marked, invoke)
        } else {
          result = invoke()
        }
      } catch (error) {
        if (incomingSpan) {
          const index = pendingExternal.findIndex(
            (pending) => pending.event === String(event) && pending.spanContext === incomingSpan,
          )
          if (index >= 0) pendingExternal.splice(index, 1)
        }
        report(error)
        return Promise.reject(error)
      }
      if (incomingSpan) {
        void result.then(
          () => {
            const index = pendingExternal.findIndex(
              (pending) => pending.event === String(event) && pending.spanContext === incomingSpan,
            )
            if (index >= 0) pendingExternal.splice(index, 1)
          },
          () => {
            const index = pendingExternal.findIndex(
              (pending) => pending.event === String(event) && pending.spanContext === incomingSpan,
            )
            if (index >= 0) pendingExternal.splice(index, 1)
          },
        )
      }
      return result
    },
  }

  // A workflow span exists even when the run has not started yet. This also gives callers a
  // stable context to inject into work that eventually calls `run.start()`.
  ensureFlow([])
  try {
    unsubscribe = run.observe(observeEvent)
  } catch (error) {
    report(error)
    observing = false
  }
  if (observing) {
    try {
      for (const event of run.log()) observeEvent(event)
    } catch (error) {
      report(error)
    }
  }
  try {
    detachFromRun = run.attach(() => () => {
      stoppingFromRunDispose = true
      try {
        stop()
      } finally {
        stoppingFromRunDispose = false
      }
    })
  } catch (error) {
    report(error)
  }

  return api
}

import {
  type Attributes,
  type Context,
  context,
  createContextKey,
  type SpanContext,
} from '@opentelemetry/api'
import type { AnyWizard, EventType, PayloadInput, Run, SendResult } from '@openwizard/core'
import { asPath, type EventRecord, type FlowRecord, spanContextOf } from './span-state'
import type { ExternalSendOptions, InstrumentRunOptions } from './types'
import type { WorkflowSpans } from './workflow-spans'

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

interface PendingExternal {
  readonly event: string
  readonly eventId: string | undefined
  readonly spanContext: SpanContext
}

export function createExternalEvents<F extends AnyWizard>(
  run: Run<F>,
  workflows: WorkflowSpans,
  options: InstrumentRunOptions,
  report: (error: unknown) => void,
) {
  const recordEvents = options.recordEvents ?? 'lifecycle'
  const pendingExternal: PendingExternal[] = []
  let externalContextOverride: Context | undefined

  const takeExternal = (event: EventRecord): SpanContext | undefined => {
    const eventId = typeof event.eventId === 'string' ? event.eventId : undefined
    const index = pendingExternal.findIndex(
      (pending) => pending.event === event.event && pending.eventId === eventId,
    )
    if (index < 0) return undefined
    return pendingExternal.splice(index, 1)[0]?.spanContext
  }

  const recordEvent = (record: FlowRecord | undefined, event: EventRecord): void => {
    if (!record) return
    const shouldRecord =
      recordEvents !== 'none' && (recordEvents === 'all' || LIFECYCLE_EVENTS.has(event.type))
    const attributes: Attributes = {}
    if (shouldRecord) {
      attributes['openwizard.event.type'] = event.type
      if (event.seq !== undefined) attributes['openwizard.event.seq'] = event.seq
      if (event.causedBy !== undefined) attributes['openwizard.event.caused_by'] = event.causedBy
      if (event.at !== undefined) attributes['openwizard.event.logical_time_ms'] = event.at
      attributes['openwizard.event.path'] = [...asPath(event.path)]
      if ('correlationId' in event) attributes['openwizard.event.has_correlation_id'] = true
    }
    if (event.type === 'event.received') {
      const active = context.active()
      const incoming =
        takeExternal(event) ??
        spanContextOf(externalContextOverride) ??
        (active.getValue(EXTERNAL_CONTEXT_KEY) === true ? spanContextOf(active) : undefined)
      if (incoming) {
        workflows.addLink(record.span, incoming, 'external-event')
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

  const withExternalContext = <T>(incoming: Context, fn: () => T): T => {
    const marked = incoming.setValue(EXTERNAL_CONTEXT_KEY, true)
    const previous = externalContextOverride
    externalContextOverride = marked
    try {
      return context.with(marked, fn)
    } finally {
      externalContextOverride = previous
    }
  }

  const send = <E extends EventType<F>, P>(
    event: E,
    payload: unknown extends P ? P : PayloadInput<F, E>,
    sendOptions?: ExternalSendOptions,
  ): Promise<SendResult> => {
    const { context: incomingContext, ...coreOptions } = sendOptions ?? {}
    const active = context.active()
    const incoming =
      incomingContext ??
      externalContextOverride ??
      (active.getValue(EXTERNAL_CONTEXT_KEY) === true ? active : undefined)
    const incomingSpan = spanContextOf(incoming)
    const pending = incomingSpan
      ? { event: String(event), eventId: coreOptions.eventId, spanContext: incomingSpan }
      : undefined
    if (pending) pendingExternal.push(pending)
    const removePending = (): void => {
      if (!pending) return
      const index = pendingExternal.indexOf(pending)
      if (index >= 0) pendingExternal.splice(index, 1)
    }
    let result: Promise<SendResult>
    try {
      const invoke = (): Promise<SendResult> => run.send(event, payload, coreOptions)
      result = incomingContext
        ? context.with(incomingContext.setValue(EXTERNAL_CONTEXT_KEY, true), invoke)
        : invoke()
    } catch (error) {
      removePending()
      report(error)
      return Promise.reject(error)
    }
    if (pending) void result.then(removePending, removePending)
    return result
  }

  const clear = (): void => {
    pendingExternal.length = 0
  }
  return { recordEvent, withExternalContext, send, clear }
}

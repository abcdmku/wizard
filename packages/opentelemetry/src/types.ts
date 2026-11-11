import type { Context, Span, SpanContext, Tracer } from '@opentelemetry/api'
import type { AnyWizard, EventType, PayloadInput, SendResult } from '@openwizard/core'

type InstanceIdOption = 'raw' | 'none' | ((id: string) => string | undefined)

/** Options for `instrumentRun`. @public */
export interface InstrumentRunOptions {
  /** Tracer to use. Defaults to `trace.getTracer('@openwizard/opentelemetry')`. */
  readonly tracer?: Tracer
  /** Context used as the parent of the root workflow span. */
  readonly parentContext?: Context
  /** Context (or span context) from an earlier process/epoch. It becomes a span link. */
  readonly resumeContext?: Context | SpanContext
  /** Trace child runs observed through this run. Defaults to `true`. */
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
  /** Delivery id preserved by the run for event deduplication. */
  readonly eventId?: string
  /** Extracted request/message context to link to `event.received`. */
  readonly context?: Context
}

/** Handle returned by `instrumentRun`. @public */
export interface RunInstrumentation<F extends AnyWizard> {
  /** Stop observing and finish open spans. Calling this more than once is safe. */
  stop(): void
  /** Return the workflow span for a path, if it has been created. */
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
  send<E extends EventType<F>, P>(
    event: E,
    payload: unknown extends P ? P : PayloadInput<F, E>,
    options?: ExternalSendOptions,
  ): Promise<SendResult>
}

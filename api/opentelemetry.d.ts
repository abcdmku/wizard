import { Context, Span, SpanContext, Tracer } from "@opentelemetry/api";
import { AnyFlow, EventType, FlowRun, SendResult } from "@openwizard/core";
//#region src/index.d.ts
type InstanceIdOption = 'raw' | 'none' | ((id: string) => string | undefined);
/** Options for `instrumentRun`. @public */
interface InstrumentRunOptions {
  /** Tracer to use. Defaults to `trace.getTracer('@openwizard/opentelemetry')`. */
  readonly tracer?: Tracer;
  /** Context used as the parent of the root workflow span. */
  readonly parentContext?: Context;
  /** Context (or span context) from an earlier process/epoch. It becomes a span link. */
  readonly resumeContext?: Context | SpanContext;
  /** Trace child flows observed through this run. Defaults to `true`. */
  readonly children?: boolean;
  /** Event detail recorded on workflow spans. Defaults to `'lifecycle'`. */
  readonly recordEvents?: 'none' | 'lifecycle' | 'all';
  /** Controls whether the instance identifier is put on spans. Defaults to `'raw'`. */
  readonly instanceId?: InstanceIdOption;
  /** Called for adapter/tracer errors. It is never called for workflow errors. */
  readonly onError?: (error: unknown) => void;
  /** Set successful spans to `OK`; by default only failures set a status. */
  readonly successStatus?: boolean;
}
/** Options for the instrumentation `send` convenience method. @public */
interface ExternalSendOptions {
  /** The workflow's normal correlation id, if the caller needs to supply one. */
  readonly correlationId?: string;
  /** Extracted request/message context to link to `event.received`. */
  readonly context?: Context;
}
/** Handle returned by `instrumentRun`. @public */
interface RunInstrumentation<F extends AnyFlow> {
  /** Stop observing and finish open spans. Calling this more than once is safe. */
  stop(): void;
  /** Return the workflow/task span for a path, if it has been created. */
  span(path?: readonly string[]): Span | undefined;
  /** Return a context containing the span for a path, if it has been created. */
  context(path?: readonly string[]): Context | undefined;
  /** Inject the selected workflow span context into a carrier. */
  inject(carrier: Record<string, string>, path?: readonly string[]): void;
  /** Extract a propagation context from a carrier. */
  extract(carrier: Record<string, string>, base?: Context): Context;
  /** Run a callback with an incoming context marked as an external-event context. */
  withExternalContext<T>(incoming: Context, fn: () => T): T;
  /** Send an external event and optionally associate its incoming trace context. */
  send<E extends EventType<F>>(event: E, payload: unknown, options?: ExternalSendOptions): Promise<SendResult>;
}
/**
 * Attach OpenTelemetry workflow, task-attempt, compensation, and nested-flow spans to a run.
 *
 * Only stable identifiers, event names, counters, paths, and boolean outcomes are exported.
 * Payloads, outputs, input/context patches, inbox/correlation values, idempotency keys, and
 * error messages are intentionally never copied to spans.
 * @public
 */
declare function instrumentRun<F extends AnyFlow>(run: FlowRun<F>, options?: InstrumentRunOptions): RunInstrumentation<F>;
//#endregion
export { ExternalSendOptions, InstrumentRunOptions, RunInstrumentation, instrumentRun };
//# sourceMappingURL=index.d.ts.map
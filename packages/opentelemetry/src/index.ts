/**
 * OpenTelemetry tracing for an OpenWizard `Run`.
 *
 * The adapter observes the event stream. Tracer errors are reported to `onError` and ignored
 * so that telemetry cannot change workflow behaviour.
 * @packageDocumentation
 */

import { type Context, context, propagation } from '@opentelemetry/api'
import type { AnyWizard, Run, RunEvent } from '@openwizard/core'
import { createExternalEvents } from './external-events'
import {
  asNumber,
  asPath,
  asString,
  type EventRecord,
  type Outcome,
  safeOutcome,
} from './span-state'
import { createStepSpans } from './step-spans'
import type { InstrumentRunOptions, RunInstrumentation } from './types'
import { createWorkflowSpans } from './workflow-spans'

export type { ExternalSendOptions, InstrumentRunOptions, RunInstrumentation } from './types'

/**
 * Attach OpenTelemetry workflow, step-attempt, compensation, and nested-flow spans to a run.
 *
 * Only stable identifiers, event names, counters, paths, and boolean outcomes are exported.
 * Payloads, outputs, input/context patches, inbox/correlation values, idempotency keys, and
 * error messages are never copied to spans.
 * @public
 */
export function instrumentRun<F extends AnyWizard>(
  run: Run<F>,
  options: InstrumentRunOptions = {},
): RunInstrumentation<F> {
  const report = (error: unknown): void => {
    try {
      options.onError?.(error)
    } catch {
      // A telemetry error handler cannot change workflow behaviour.
    }
  }
  const workflows = createWorkflowSpans(run, options, report)
  const stepSpans = createStepSpans(workflows, report)
  const external = createExternalEvents(run, workflows, options, report)
  let stopped = false
  let observing = true
  let unsubscribe: (() => void) | undefined
  let detachFromRun: (() => void) | undefined
  let stoppingFromRunDispose = false

  const closePath = (path: readonly string[], outcome: Outcome): void => {
    stepSpans.closePath(path, outcome)
    workflows.closePath(path, outcome)
  }

  const processEvent = (incomingEvent: RunEvent<F>): void => {
    if (stopped) return
    const event = incomingEvent as unknown as EventRecord
    const path = asPath(event.path)
    const record = workflows.ensureFlow(path)
    external.recordEvent(record, event)
    const step = asString(event.step)

    switch (event.type) {
      case 'flow.resumed':
        if (record) {
          const fromSeq = asNumber(event.fromSeq)
          const interrupted = Array.isArray(event.interrupted) ? event.interrupted.length : 0
          if (fromSeq !== undefined)
            workflows.setAttribute(record.span, 'openwizard.resume.from_seq', fromSeq)
          workflows.setAttribute(record.span, 'openwizard.resume.interrupted_count', interrupted)
        }
        break
      case 'step.runStarted':
        if (step) stepSpans.startAttempt(event, path, step)
        break
      case 'step.runSucceeded':
        if (step) stepSpans.finishAttempt(event, path, step, 'success')
        break
      case 'step.runFailed':
        if (step) stepSpans.finishAttempt(event, path, step, 'error')
        break
      case 'step.cancelled':
        if (step) stepSpans.finishAttempt(event, path, step, 'cancelled')
        break
      case 'step.compensationStarted':
        if (step) stepSpans.startCompensation(event, path, step)
        break
      case 'step.compensated':
        if (step) stepSpans.finishCompensation(event, path, step, 'success')
        break
      case 'step.compensationFailed':
        if (step) stepSpans.finishCompensation(event, path, step, 'error')
        break
      case 'flow.done':
        closePath(path, 'success')
        break
      case 'flow.failed':
        if (record && typeof event.code === 'string')
          workflows.setAttribute(record.span, 'openwizard.flow.error_code', event.code)
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
        stepSpans.reset(path)
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
    stepSpans.stop()
    workflows.stop()
    external.clear()
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

  const api: RunInstrumentation<F> = {
    stop,
    span: (path = []) => workflows.stateFor(path)?.span,
    context: (path = []) => workflows.stateFor(path)?.spanContext,
    inject(carrier, path = []): void {
      try {
        propagation.inject(api.context(path) ?? context.active(), carrier)
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
    withExternalContext: external.withExternalContext,
    send: external.send,
  }

  // Create a context callers can inject before run.start().
  workflows.ensureFlow([])
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

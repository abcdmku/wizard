import { type Attributes, isSpanContextValid, type Link, SpanKind, trace } from '@opentelemetry/api'
import {
  type AttemptRecord,
  asNumber,
  type CompensationRecord,
  type CompletedAttempt,
  type EventRecord,
  type FlowRecord,
  isUnderPath,
  type Outcome,
  pathKey,
} from './span-state'
import type { WorkflowSpans } from './workflow-spans'

/** The kind the definition gives the step. Only a `step` runs, so that is the answer without one. */
function stepKind(source: { readonly flow: { readonly steps: unknown } }, step: string): string {
  const steps = source.flow.steps
  const definition: unknown =
    typeof steps === 'object' && steps !== null && Object.hasOwn(steps, step)
      ? Reflect.get(steps, step)
      : undefined
  return typeof definition === 'object' &&
    definition !== null &&
    'kind' in definition &&
    typeof definition.kind === 'string'
    ? definition.kind
    : 'step'
}

export function createStepSpans(workflows: WorkflowSpans, report: (error: unknown) => void) {
  const {
    root,
    tracer,
    includeChildren,
    runAt,
    flowAttributes,
    setAttribute,
    endSpan,
    stateFor,
    ensureFlow,
  } = workflows
  const attempts = new Map<string, AttemptRecord>()
  const compensations = new Map<string, CompensationRecord>()
  const completed = new Map<string, CompletedAttempt>()
  const closeAttempt = (attempt: AttemptRecord, outcome: Outcome): void => {
    if (attempt.closed) return
    attempt.closed = true
    setAttribute(attempt.span, 'openwizard.step.outcome', outcome)
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

  const stepParent = (path: readonly string[]): FlowRecord | undefined =>
    stateFor(path) ?? ensureFlow(path)

  const stepKey = (path: readonly string[], step: string): string => `${pathKey(path)}\u0000${step}`

  const startAttempt = (event: EventRecord, path: readonly string[], step: string): void => {
    const flow = stepParent(path)
    if (!flow) return
    const attemptNumber = asNumber(event.attempt) ?? 0
    const runId = asNumber(event.runId) ?? 0
    const key = stepKey(path, step)
    const previous = attempts.get(key)
    if (previous) closeAttempt(previous, 'interrupted')

    const source = runAt(path) ?? root
    const attributes: Attributes = {
      ...flowAttributes(path, source),
      'openwizard.step': step,
      'openwizard.step.kind': stepKind(source, step),
      'openwizard.step.attempt': attemptNumber,
      'openwizard.step.retry': attemptNumber > 1,
      'openwizard.step.retry_count': Math.max(0, attemptNumber - 1),
      'openwizard.step.run_id': runId,
    }
    attributes['openwizard.step.resumed'] = event.resumed === true
    try {
      const span = tracer.startSpan(
        'openwizard.step',
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
    const attempt = attempts.get(stepKey(path, step))
    if (!attempt) return
    const expected = asNumber(event.attempt)
    if (expected !== undefined && expected !== attempt.attempt) return
    if (outcome === 'error') {
      setAttribute(
        attempt.span,
        'openwizard.error.kind',
        event.timedOut === true ? 'timeout' : 'step',
      )
      if (typeof event.willRetry === 'boolean')
        setAttribute(attempt.span, 'openwizard.step.will_retry', event.willRetry)
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
    const flow = stepParent(path)
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
      ...flowAttributes(path, runAt(path) ?? root),
      'openwizard.step': step,
      'openwizard.compensation': true,
      ...(runId !== undefined ? { 'openwizard.compensation.run_id': runId } : {}),
    }
    try {
      const span = tracer.startSpan(
        'openwizard.compensation',
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

  const closePath = (path: readonly string[], outcome: Outcome): void => {
    const effectivePath = includeChildren ? path : []
    for (const attempt of [...attempts.values()]) {
      if (isUnderPath(includeChildren ? attempt.path : [], effectivePath))
        closeAttempt(attempt, outcome)
    }
    for (const compensation of [...compensations.values()]) {
      if (isUnderPath(includeChildren ? compensation.path : [], effectivePath))
        closeCompensation(compensation, outcome)
    }
  }

  const reset = (path: readonly string[]): void => {
    closePath(path, 'reset')
    for (const item of [...completed.entries()]) {
      if (isUnderPath(includeChildren ? item[1].path : [], includeChildren ? path : []))
        completed.delete(item[0])
    }
  }

  const stop = (): void => {
    closePath([], 'detached')
    attempts.clear()
    compensations.clear()
    completed.clear()
  }

  return {
    startAttempt,
    finishAttempt,
    startCompensation,
    finishCompensation,
    closePath,
    reset,
    stop,
  }
}

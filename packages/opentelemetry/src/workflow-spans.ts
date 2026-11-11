import {
  type Attributes,
  type Context,
  context,
  isSpanContextValid,
  type Link,
  type Span,
  type SpanContext,
  SpanKind,
  type SpanOptions,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api'
import type { AnyWizard, Run } from '@openwizard/core'
import { type FlowRecord, isUnderPath, type Outcome, pathKey, spanContextOf } from './span-state'
import type { InstrumentRunOptions } from './types'

export function createWorkflowSpans<F extends AnyWizard>(
  run: Run<F>,
  options: InstrumentRunOptions,
  report: (error: unknown) => void,
) {
  const tracer = options.tracer ?? trace.getTracer('@openwizard/opentelemetry', '0.0.0')
  const includeChildren = options.children !== false
  // Observed paths are dynamic; core validates child(step) before returning it.
  const root = run as unknown as Run<AnyWizard>
  const flowRecords = new Map<string, FlowRecord>()
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

  const runAt = (path: readonly string[]): Run<AnyWizard> | undefined => {
    let current = root
    for (const segment of path) {
      try {
        const child = current.child as unknown as (step: string) => Run<AnyWizard>
        current = child(segment)
      } catch {
        return undefined
      }
    }
    return current
  }

  const flowAttributes = (path: readonly string[], source: Run<AnyWizard>): Attributes => {
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
    const source = runAt(effectivePath) ?? root
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
      const span = tracer.startSpan('openwizard.workflow', spanOptions, parent)
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

  const closePath = (path: readonly string[], outcome: Outcome): void => {
    const effectivePath = includeChildren ? path : []
    for (const record of flowRecords.values()) {
      if (isUnderPath(record.path, effectivePath) && !record.ended) {
        record.ended = true
        setAttribute(record.span, 'openwizard.flow.outcome', outcome)
        endSpan(record.span, outcome)
      }
    }
  }

  const stop = (): void => {
    for (const record of [...flowRecords.values()].reverse()) {
      if (!record.ended) {
        record.ended = true
        endSpan(record.span, 'detached')
      }
    }
  }

  return {
    root,
    tracer,
    includeChildren,
    runAt,
    flowAttributes,
    addLink,
    setAttribute,
    endSpan,
    stateFor,
    ensureFlow,
    closePath,
    stop,
  }
}

export type WorkflowSpans = ReturnType<typeof createWorkflowSpans>

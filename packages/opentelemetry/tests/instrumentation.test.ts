import { propagation } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { boundary, createRun, defineFlow, resumeRun } from '@openwizard/core'
import { createTestScheduler } from '@openwizard/core/testing'
import { describe, expect, it } from 'vitest'
import { instrumentRun } from '../src/index'

function tracerFixture() {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })
  return { exporter, tracer: provider.getTracer('openwizard-test') }
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('instrumentRun', () => {
  it('emits a workflow and task span without copying payloads or errors', async () => {
    const privacy = defineFlow({
      name: 'privacy',
      version: 4,
      context: boundary.trusted<{}>(),
    })
    const flow = privacy.steps(
      {
        charge: privacy.task(() => ({ secretOutput: 'do-not-export' }), { next: 'done' }),
        done: privacy.final(),
      },
      { start: 'charge' },
    )
    const run = createRun(flow, { context: {}, instanceId: 'order-42' })
    const { exporter, tracer } = tracerFixture()
    const instrumentation = instrumentRun(run, { tracer })

    await run.start()
    instrumentation.stop()

    const spans = exporter.getFinishedSpans()
    expect(spans.map((span) => span.name)).toEqual(
      expect.arrayContaining(['openwizard.workflow', 'openwizard.task']),
    )
    const task = spans.find((span) => span.name === 'openwizard.task')
    expect(task?.attributes).toMatchObject({
      'openwizard.step': 'charge',
      'openwizard.task.attempt': 1,
      'openwizard.task.retry': false,
      'openwizard.instance.id': 'order-42',
    })
    const serialized = JSON.stringify(
      spans.map((span) => ({ name: span.name, attributes: span.attributes, events: span.events })),
    )
    expect(serialized).not.toContain('do-not-export')
    expect(serialized).not.toContain('secretOutput')
    expect(serialized).not.toContain('error.message')
  })

  it('creates one task span for each retry attempt and closes it on stop', async () => {
    let calls = 0
    const retry = defineFlow({ name: 'retry', context: boundary.trusted<{}>() })
    const flow = retry.steps(
      {
        work: retry.task(
          () => {
            calls += 1
            if (calls === 1) throw new Error('private failure')
            return 'ok'
          },
          { retry: { attempts: 2, backoff: 5 }, next: 'done' },
        ),
        done: retry.final(),
      },
      { start: 'work' },
    )
    const scheduler = createTestScheduler({ now: 100 })
    const run = createRun(flow, { context: {}, scheduler })
    const { exporter, tracer } = tracerFixture()
    const instrumentation = instrumentRun(run, { tracer })

    await run.start()
    await settle()
    scheduler.advance(5)
    await settle()
    instrumentation.stop()

    const tasks = exporter
      .getFinishedSpans()
      .filter((span) => span.name === 'openwizard.task')
      .sort(
        (a, b) =>
          Number(a.attributes['openwizard.task.attempt']) -
          Number(b.attributes['openwizard.task.attempt']),
      )
    expect(calls).toBe(2)
    expect(tasks.map((span) => span.attributes['openwizard.task.attempt'])).toEqual([1, 2])
    expect(tasks[1]?.attributes['openwizard.task.retry']).toBe(true)
    expect(
      JSON.stringify(tasks.map((span) => ({ attributes: span.attributes, events: span.events }))),
    ).not.toContain('private failure')
  })

  it('links external event context and supports inject/extract helpers', async () => {
    propagation.setGlobalPropagator(new W3CTraceContextPropagator())
    const external = defineFlow({
      name: 'external',
      context: boundary.trusted<{}>(),
      events: { 'payment.captured': boundary.trusted<unknown>() },
    })
    const flow = external.steps(
      {
        wait: external.wait({ on: { 'payment.captured': () => undefined }, next: 'done' }),
        done: external.final(),
      },
      { start: 'wait' },
    )
    const run = createRun(flow, { context: {}, instanceId: 'external-1' })
    const { exporter, tracer } = tracerFixture()
    const instrumentation = instrumentRun(run, { tracer })
    const incomingSpan = tracer.startSpan('incoming-request')
    const carrier: Record<string, string> = {}
    instrumentation.inject(carrier)
    const extracted = instrumentation.extract(carrier)

    await run.start()
    const sendResult = await instrumentation.withExternalContext(extracted, () =>
      instrumentation.send(
        'payment.captured',
        { cardNumber: 'private' },
        { correlationId: 'secret-correlation', context: extracted },
      ),
    )
    expect(sendResult.ok).toBe(true)
    incomingSpan.end()
    instrumentation.stop()

    const workflow = exporter
      .getFinishedSpans()
      .find(
        (span) =>
          span.name === 'openwizard.workflow' &&
          span.attributes['openwizard.path']?.toString() === '',
      )
    expect(
      workflow?.links.some(
        (link) => link.attributes?.['openwizard.link.type'] === 'external-event',
      ),
    ).toBe(true)
    expect(
      JSON.stringify({ attributes: workflow?.attributes, events: workflow?.events }),
    ).not.toContain('cardNumber')
    expect(
      JSON.stringify({ attributes: workflow?.attributes, events: workflow?.events }),
    ).not.toContain('secret-correlation')
  })

  it('parents child workflow spans by path and links compensation to the task', async () => {
    const childSpec = defineFlow({ name: 'child', context: boundary.trusted<{}>() })
    const child = childSpec.steps(
      { work: childSpec.task(() => 'child-output', { next: 'done' }), done: childSpec.final() },
      { start: 'work' },
    )
    const parentSpec = defineFlow({ name: 'parent', context: boundary.trusted<{}>() })
    const parent = parentSpec.steps(
      {
        child: parentSpec.flow(child, { context: () => ({}), next: 'done' }),
        done: parentSpec.final(),
      },
      { start: 'child' },
    )
    const run = createRun(parent, { context: {} })
    const { exporter, tracer } = tracerFixture()
    const instrumentation = instrumentRun(run, { tracer })
    await run.start()
    await settle()
    instrumentation.stop()

    const spans = exporter.getFinishedSpans()
    const root = spans.find(
      (span) =>
        span.name === 'openwizard.workflow' &&
        span.attributes['openwizard.path']?.toString() === '',
    )
    const childSpan = spans.find(
      (span) =>
        span.name === 'openwizard.workflow' &&
        span.attributes['openwizard.path']?.toString() === 'child',
    )
    expect(childSpan?.attributes['openwizard.flow.name']).toBe('child')
    expect(childSpan?.parentSpanContext?.spanId).toBe(root?.spanContext().spanId)
  })

  it('links a compensation span to the completed task attempt', async () => {
    const saga = defineFlow({
      name: 'saga',
      context: boundary.trusted<{}>(),
      events: { abort: boundary.trusted<unknown>() },
      onFailure: 'compensate',
    })
    const flow = saga.steps(
      {
        reserve: saga.task(() => 'reserved', { next: 'hold', compensate: () => undefined }),
        hold: saga.wait({ on: { abort: () => undefined } }),
      },
      { start: 'reserve' },
    )
    const run = createRun(flow, { context: {} })
    const { exporter, tracer } = tracerFixture()
    const instrumentation = instrumentRun(run, { tracer })
    await run.start()
    await run.cancel('operator')
    instrumentation.stop()

    const spans = exporter.getFinishedSpans()
    const compensation = spans.find((span) => span.name === 'openwizard.compensation')
    expect(compensation?.attributes['openwizard.step']).toBe('reserve')
    expect(
      compensation?.links.some(
        (link) => link.attributes?.['openwizard.link.type'] === 'compensation',
      ),
    ).toBe(true)
  })

  it('links a resumed epoch and makes teardown idempotent', async () => {
    const resume = defineFlow({
      name: 'resume',
      context: boundary.trusted<{}>(),
      events: { ping: boundary.trusted<unknown>() },
    })
    const flow = resume.steps(
      { wait: resume.wait({ on: { ping: () => undefined } }) },
      { start: 'wait' },
    )
    const first = createRun(flow, { context: {}, instanceId: 'resume-1' })
    const firstFixture = tracerFixture()
    const prior = instrumentRun(first, { tracer: firstFixture.tracer })
    await first.start()
    const snapshot = first.getSnapshot()
    const priorContext = prior.context()
    prior.stop()

    const resumed = resumeRun(flow, snapshot, {})
    const secondFixture = tracerFixture()
    const next = instrumentRun(resumed, {
      tracer: secondFixture.tracer,
      ...(priorContext ? { resumeContext: priorContext } : {}),
    })
    next.stop()
    next.stop()

    const workflow = secondFixture.exporter
      .getFinishedSpans()
      .find((span) => span.name === 'openwizard.workflow')
    expect(workflow?.attributes['openwizard.resumed']).toBe(true)
    expect(
      workflow?.links.some((link) => link.attributes?.['openwizard.link.type'] === 'resume'),
    ).toBe(true)
  })
})

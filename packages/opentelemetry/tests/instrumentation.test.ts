import { propagation, ROOT_CONTEXT, trace } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { boundary, defineWizard } from '@openwizard/core'
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
    const wizard = defineWizard(
      { name: 'privacy', version: 4, context: boundary.trusted<{}>() },
      ({ step, steps }) =>
        steps({ charge: step({ run: () => ({ secretOutput: 'do-not-export' }) }) }),
    )
    const run = wizard.create({}, { instanceId: 'order-42' })
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
    const wizard = defineWizard(
      { name: 'retry', context: boundary.trusted<{}>() },
      ({ step, steps }) =>
        steps({
          work: step({
            run: () => {
              calls += 1
              if (calls === 1) throw new Error('private failure')
              return 'ok'
            },
            retry: { retries: 2, backoff: 5 },
          }),
        }),
    )
    const scheduler = createTestScheduler({ now: 100 })
    const run = wizard.create({}, { scheduler })
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
    const wizard = defineWizard(
      {
        name: 'external',
        context: boundary.trusted<{}>(),
        events: { 'payment.captured': boundary.trusted<unknown>() },
      },
      ({ step, steps }) =>
        steps({
          wait: step({ waitFor: { 'payment.captured': () => ({ done: true }) } }),
        }),
    )
    const run = wizard.create({}, { instanceId: 'external-1' })
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

  it('parents child workflow spans by path', async () => {
    const child = defineWizard(
      { name: 'child', context: boundary.trusted<{}>() },
      ({ step, steps }) => steps({ work: step({ run: () => 'child-output' }) }),
    )
    const parent = defineWizard(
      { name: 'parent', context: boundary.trusted<{}>() },
      ({ flow, steps }) => steps({ child: flow(child, { context: () => ({}) }) }),
    )
    const run = parent.create({})
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

  it('preserves delivery and correlation ids when an instrumented event is redelivered', async () => {
    const wizard = defineWizard(
      {
        name: 'delivery',
        context: boundary.trusted<{ count: number }>(),
        events: { paid: boundary.trusted<{ amount: number }>() },
      },
      ({ step, steps }) =>
        steps({
          tally: step({
            waitFor: {
              paid: ({ context, payload, update }) => {
                update({ count: context.count + payload.amount })
                return { keep: true }
              },
            },
          }),
        }),
    )
    const run = wizard.create({ count: 0 }, { correlationId: 'invoice-7' })
    const { exporter, tracer } = tracerFixture()
    const instrumentation = instrumentRun(run, { tracer })
    const incoming = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: '12345678901234567890123456789012',
      spanId: '1234567890123456',
      traceFlags: 1,
    })
    const options = { eventId: 'delivery-1', correlationId: 'invoice-7', context: incoming }
    await run.start()
    expect(await instrumentation.send('paid', { amount: 1 }, options)).toMatchObject({
      ok: true,
      delivered: ['tally'],
    })
    const seq = run.getState().seq
    expect(await instrumentation.send('paid', { amount: 1 }, options)).toEqual({
      ok: true,
      duplicate: true,
      delivered: [],
      buffered: false,
      seq,
    })
    expect(run.getState().context).toEqual({ count: 1 })
    expect(
      run
        .log()
        .filter((event) => event.type === 'event.received')
        .map((event) => ({
          event: event.event,
          eventId: event.eventId,
          correlationId: event.correlationId,
        })),
    ).toEqual([{ event: 'paid', eventId: 'delivery-1', correlationId: 'invoice-7' }])
    instrumentation.stop()
    const workflow = exporter.getFinishedSpans().find((span) => span.name === 'openwizard.workflow')
    expect(
      workflow?.links.filter(
        (link) => link.attributes?.['openwizard.link.type'] === 'external-event',
      ),
    ).toHaveLength(1)
    expect(
      workflow?.events.filter((event) => event.name === 'openwizard.event.received'),
    ).toHaveLength(1)
    expect(JSON.stringify(workflow?.events)).not.toContain('delivery-1')
    expect(JSON.stringify(workflow?.events)).not.toContain('invoice-7')
    run.dispose()
  })

  it('traces tasks started through startStep and startReady', async () => {
    const wizard = defineWizard(
      { name: 'manual', context: boundary.trusted<{}>(), autoRun: 'manual' },
      ({ step, steps }) =>
        steps(
          {
            one: step({ run: () => 1 }),
            two: step({ run: () => 2 }),
          },
          { start: ['one', 'two'] },
        ),
    )
    const run = wizard.create({})
    const { exporter, tracer } = tracerFixture()
    const instrumentation = instrumentRun(run, { tracer })
    await run.start()
    await run.startStep('one')
    await run.startReady()
    instrumentation.stop()
    expect(
      exporter
        .getFinishedSpans()
        .filter((span) => span.name === 'openwizard.task')
        .map((span) => span.attributes['openwizard.step']),
    ).toEqual(['one', 'two'])
    run.dispose()
  })

  it('links a compensation span to the completed task attempt', async () => {
    const wizard = defineWizard(
      {
        name: 'saga',
        context: boundary.trusted<{}>(),
        events: { abort: boundary.trusted<unknown>() },
        onFailure: 'compensate',
      },
      ({ step, steps }) =>
        steps({
          reserve: step({ run: () => 'reserved', next: 'hold', compensate: () => undefined }),
          hold: step({ waitFor: { abort: () => ({ done: true }) } }),
        }),
    )
    const run = wizard.create({})
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
    const wizard = defineWizard(
      {
        name: 'resume',
        context: boundary.trusted<{}>(),
        events: { ping: boundary.trusted<unknown>() },
      },
      ({ step, steps }) => steps({ wait: step({ waitFor: { ping: () => ({ done: true }) } }) }),
    )
    const first = wizard.create({}, { instanceId: 'resume-1' })
    const firstFixture = tracerFixture()
    const prior = instrumentRun(first, { tracer: firstFixture.tracer })
    await first.start()
    const snapshot = first.getSnapshot()
    const priorContext = prior.context()
    prior.stop()

    const resumed = wizard.resume(snapshot)
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

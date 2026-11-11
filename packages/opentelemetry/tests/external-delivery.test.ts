import { ROOT_CONTEXT, trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { boundary, defineWizard } from '@openwizard/core'
import { expect, it } from 'vitest'
import { instrumentRun } from '../src/index'

it('keeps a duplicate event trace context out of the next accepted delivery', async () => {
  const wizard = defineWizard(
    {
      name: 'deliveries',
      context: boundary.trusted<{}>(),
      events: { ping: boundary.trusted<{}>() },
    },
    ({ step, steps }) => steps({ wait: step({ waitFor: { ping: () => ({ keep: true }) } }) }),
  )
  const run = wizard.create({})
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
  const telemetry = instrumentRun(run, { tracer: provider.getTracer('deliveries') })
  const incoming = (digit: string) =>
    trace.setSpanContext(ROOT_CONTEXT, {
      traceId: digit.repeat(32),
      spanId: digit.repeat(16),
      traceFlags: 1,
    })
  await run.start()
  await telemetry.send('ping', {}, { eventId: 'one', context: incoming('1') })
  // The second delivery starts before the duplicate send's promise settles.
  const duplicate = telemetry.send('ping', {}, { eventId: 'one', context: incoming('2') })
  const accepted = telemetry.send('ping', {}, { eventId: 'two', context: incoming('3') })
  expect(await duplicate).toMatchObject({ ok: true, duplicate: true, delivered: [] })
  expect(await accepted).toMatchObject({ ok: true, delivered: ['wait'] })
  telemetry.stop()
  const workflow = exporter.getFinishedSpans().find((span) => span.name === 'openwizard.workflow')
  expect(
    workflow?.links
      .filter((link) => link.attributes?.['openwizard.link.type'] === 'external-event')
      .map((link) => link.context.traceId),
  ).toEqual(['1'.repeat(32), '3'.repeat(32)])
  expect(
    run
      .log()
      .filter((event) => event.type === 'event.received')
      .map((event) => event.eventId),
  ).toEqual(['one', 'two'])
  run.dispose()
})

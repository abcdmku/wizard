/**
 * An ingest pipeline with a view, retry, fan-out, gated decision, event wait and child wizard.
 * The child joins typed data through `needs`; routing declares its possible targets.
 * A loop and an orphan step exercise the layout's cycle and isolated-node handling.
 */
import { boundary, defineProjection, defineWizard } from '@openwizard/core'
import { createMirror, createMirrorSource } from '@openwizard/core/mirror'
import { createLocalTransport, createTestScheduler } from '@openwizard/core/testing'
import { z } from 'zod'

export interface Deps {
  api: { fetch(): Promise<number> }
}

export const packFlow = defineWizard(
  { name: 'pack', context: z.object({ items: z.number() }) },
  ({ step, steps }) => {
    const count = step({ run: ({ context }) => context.items * 2 })
    return steps({ count, packed: step({ needs: { count }, run: ({ needs }) => needs.count }) })
  },
)

export const pipeline = defineWizard(
  {
    name: 'ingest',
    context: z.object({
      source: z.string(),
      rows: z.number().optional(),
      quality: z.number().default(0),
    }),
    events: { 'payment.captured': z.object({ paymentId: z.string() }) },
    deps: boundary.trusted<Deps>(),
    concurrency: 2,
  },
  ({ step, view, flow, steps }) =>
    steps(
      {
        form: view({
          input: z.object({ name: z.string().min(1) }),
          initial: { name: '' },
          next: 'ingest',
        }),
        ingest: step({
          run: async ({ deps, update }) => {
            const rows = await deps.api.fetch()
            update({ rows })
            return { rows }
          },
          retry: { retries: 2, backoff: 100 },
          next: ['normalize', 'enrich'],
        }),
        normalize: step({
          run: ({ context }) => ({ normalized: context.rows ?? 0 }),
          next: 'gate',
        }),
        enrich: step({
          run: ({ update }) => update({ quality: 0.9 }),
          when: ({ context }) => (context.rows ?? 0) > 0,
          next: 'gate',
        }),
        gate: step({
          dependsOn: ['normalize', 'enrich'],
          targets: ['awaitPayment', 'rejected'],
          next: ({ context }) => (context.quality >= 0.8 ? 'awaitPayment' : 'rejected'),
        }),
        awaitPayment: step({
          waitFor: { 'payment.captured': ({ payload }) => ({ done: payload.paymentId }) },
          timeout: { after: '15m', next: 'rejected' },
          next: 'pack',
        }),
        pack: flow(packFlow, {
          context: ({ context }) => ({ items: context.rows ?? 0 }),
          next: 'review',
        }),
        review: view({ input: z.object({}), next: 'done' }),
        // This entry closes a cycle through form and review.
        again: view({ input: z.object({}), next: 'form' }),
        rejected: step({ run: () => 'rejected' }),
        done: step({ run: ({ context }) => `stored ${context.rows ?? 0} rows` }),
        orphan: step({ run: () => undefined }),
      },
      { start: 'form' },
    ),
)

export const context = { source: 'crm' }

export function makeRun(fetch: () => Promise<number> = async () => 100) {
  const sched = createTestScheduler({ now: 1_000 })
  const run = pipeline.create(context, {
    deps: { api: { fetch } },
    scheduler: sched,
    logSize: 1_000,
  })
  return { run, sched }
}

export const pipelineClient = defineProjection(pipeline, {
  expose: {
    steps: {
      form: { input: true, issues: true },
      ingest: { error: true, output: true },
      pack: { child: { steps: { count: { output: true } } } },
    },
    context: ['source'],
    output: true,
  },
})

/** A run plus a loopback Mirror over `pipelineClient` (serialized, like a wire). */
export function makeMirror(fetch?: () => Promise<number>) {
  const { run, sched } = makeRun(fetch)
  const source = createMirrorSource(run, pipelineClient)
  const mirror = createMirror<typeof pipelineClient>({
    transport: createLocalTransport(source, { serialize: true }),
  })
  return { run, sched, mirror }
}

export const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/** Drive the run through form → ingest → branches → gate → awaitPayment (active). */
export async function runToWait(run: ReturnType<typeof makeRun>['run']): Promise<void> {
  await run.start()
  await run.setInput('form', { name: 'ada' })
  await run.next()
  await settle()
  await settle()
}

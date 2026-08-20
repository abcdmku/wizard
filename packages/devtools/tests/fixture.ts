/**
 * Shared fixture: an ingest pipeline (view → task with retry → fan-out → AND-join decision →
 * wait → nested child flow → finals) plus a `back` loop, a dynamic decision and an orphan step,
 * so the graph has every edge kind, a cycle, a `?` port, a group and an isolated node.
 */
import {
  boundary,
  createMirror,
  createMirrorSource,
  createRun,
  defineFlow,
  defineProjection,
} from '@openwizard/core'
import { createLocalTransport, createTestScheduler } from '@openwizard/core/testing'
import { z } from 'zod'

export interface Deps {
  api: { fetch(): Promise<number> }
}

const pack = defineFlow({ name: 'pack', context: z.object({ items: z.number() }) })
export const packFlow = pack.steps(
  {
    count: pack.task(({ context }) => context.items * 2, { next: 'packed' }),
    packed: pack.final({ output: ({ steps }) => steps.count?.output }),
  },
  { start: 'count' },
)

const ingest = defineFlow({
  name: 'ingest',
  context: z.object({
    source: z.string(),
    rows: z.number().optional(),
    quality: z.number().default(0),
  }),
  events: { 'payment.captured': z.object({ paymentId: z.string() }) },
  deps: boundary.trusted<Deps>(),
  concurrency: 2,
})

export const pipeline = ingest.steps(
  {
    form: ingest.view({
      input: z.object({ name: z.string().min(1) }),
      initial: { name: '' },
      next: 'ingest',
    }),
    ingest: ingest.task(
      async ({ deps, update }) => {
        const rows = await deps.api.fetch()
        update({ rows })
        return { rows }
      },
      { retry: { attempts: 2, backoff: 100 }, next: ['normalize', 'enrich'] },
    ),
    normalize: ingest.task(({ context }) => ({ normalized: context.rows ?? 0 }), { next: 'gate' }),
    enrich: ingest.task(({ update }) => update({ quality: 0.9 }), {
      when: ({ context }) => (context.rows ?? 0) > 0,
      next: 'gate',
    }),
    gate: ingest.decision({
      dependsOn: ['normalize', 'enrich'],
      next: ({ context }) => (context.quality >= 0.8 ? 'awaitPayment' : 'rejected'),
    }),
    awaitPayment: ingest.wait({
      on: { 'payment.captured': () => undefined },
      timeout: { after: '15m', next: 'rejected' },
      next: 'pack',
    }),
    pack: ingest.flow(packFlow, {
      context: ({ context }) => ({ items: context.rows ?? 0 }),
      next: 'review',
    }),
    review: ingest.view({ next: 'done' }),
    // A `back`-like loop: review → form closes a cycle (NAV_CYCLE) the layout must break.
    again: ingest.view({ next: 'form' }),
    rejected: ingest.final({ output: () => 'rejected' }),
    done: ingest.final({ output: ({ context }) => `stored ${context.rows ?? 0} rows` }),
    orphan: ingest.final(),
  },
  { start: 'form' },
)

export const context = { source: 'crm' }

export function makeRun(fetch: () => Promise<number> = async () => 100) {
  const sched = createTestScheduler({ now: 1_000 })
  const run = createRun(pipeline, {
    context,
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

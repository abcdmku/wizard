/**
 * Shared fixture: an ingest pipeline (view → task with retry → fan-out → AND-join decision →
 * wait → nested child flow → finals) plus a `back` loop, a dynamic decision and an orphan step,
 * so the graph has every edge kind, a cycle, a `?` port, a group and an isolated node.
 */
import {
  boundary,
  createMirror,
  createMirrorSource,
  createWizard,
  defineFlow,
  defineProjection,
} from '@openwizard/core'
import { createLocalTransport, createTestScheduler } from '@openwizard/core/testing'
import { z } from 'zod'

export interface Deps {
  api: { fetch(): Promise<number> }
}

const c = defineFlow({ name: 'pack', context: z.object({ items: z.number() }) })
export const packFlow = c.steps(
  {
    count: c.task(({ context }) => context.items * 2, { next: 'packed' }),
    packed: c.final({ output: ({ steps }) => steps.count?.output }),
  },
  { start: 'count' },
)

const s = defineFlow({
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

export const pipeline = s.steps(
  {
    form: s.view({
      input: z.object({ name: z.string().min(1) }),
      initial: { name: '' },
      next: 'ingest',
    }),
    ingest: s.task(
      async ({ deps, update }) => {
        const rows = await deps.api.fetch()
        update({ rows })
        return { rows }
      },
      { retry: { attempts: 2, backoff: 100 }, next: ['normalize', 'enrich'] },
    ),
    normalize: s.task(({ context }) => ({ normalized: context.rows ?? 0 }), { next: 'gate' }),
    enrich: s.task(({ update }) => update({ quality: 0.9 }), {
      when: ({ context }) => (context.rows ?? 0) > 0,
      next: 'gate',
    }),
    gate: s.decision({
      dependsOn: ['normalize', 'enrich'],
      next: ({ context }) => (context.quality >= 0.8 ? 'awaitPayment' : 'rejected'),
    }),
    awaitPayment: s.wait({
      on: { 'payment.captured': () => undefined },
      timeout: { after: '15m', next: 'rejected' },
      next: 'pack',
    }),
    pack: s.flow(packFlow, {
      context: ({ context }) => ({ items: context.rows ?? 0 }),
      next: 'review',
    }),
    review: s.view({ next: 'done' }),
    // A `back`-like loop: review → form closes a cycle (NAV_CYCLE) the layout must break.
    again: s.view({ next: 'form' }),
    rejected: s.final({ output: () => 'rejected' }),
    done: s.final({ output: ({ context }) => `stored ${context.rows ?? 0} rows` }),
    orphan: s.final(),
  },
  { start: 'form' },
)

export const context = { source: 'crm' }

export function makeWizard(fetch: () => Promise<number> = async () => 100) {
  const sched = createTestScheduler({ now: 1_000 })
  const wizard = createWizard(pipeline, {
    context,
    deps: { api: { fetch } },
    scheduler: sched,
    logSize: 1_000,
  })
  return { wizard, sched }
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

/** A wizard plus a loopback Mirror over `pipelineClient` (serialized, like a wire). */
export function makeMirror(fetch?: () => Promise<number>) {
  const { wizard, sched } = makeWizard(fetch)
  const source = createMirrorSource(wizard, pipelineClient)
  const mirror = createMirror<typeof pipelineClient>({
    transport: createLocalTransport(source, { serialize: true }),
  })
  return { wizard, sched, mirror }
}

export const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/** Drive the wizard through form → ingest → branches → gate → awaitPayment (active). */
export async function runToWait(wizard: ReturnType<typeof makeWizard>['wizard']): Promise<void> {
  await wizard.start()
  await wizard.setInput('form', { name: 'ada' })
  await wizard.next()
  await settle()
  await settle()
}

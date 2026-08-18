/**
 * Example 07's ingest pipeline — `ingest → (normalize ∥ enrich) → gate → persist → done`, with
 * `when` on the enrichment branch and an AND-join decision — plus one addition so the page has
 * an external event to send: an `approve` wait step (with a timeout) before `persist`.
 */
import { boundary, defineFlow } from '@openwizard/core'
import { z } from 'zod'

export interface Deps {
  source: { fetch(name: string): { rows: number } }
  normalizer: { run(rows: number): Promise<{ normalized: number }> }
  enricher: { run(rows: number): Promise<{ enriched: number; quality: number }> }
  warehouse: { write(batch: { normalized: number; enriched: number }): { batchId: string } }
}

const s = defineFlow({
  name: 'ingest-pipeline',
  version: 2,
  context: z.object({
    source: z.string(),
    rows: z.number().int().nonnegative().default(0),
    normalized: z.number().int().nonnegative().optional(),
    enriched: z.number().int().nonnegative().optional(),
    quality: z.number().min(0).max(1).default(0),
    enrichment: z.enum(['on', 'off']).default('on'),
    approvedBy: z.string().optional(),
  }),
  events: { 'review.approved': z.object({ by: z.string().min(1) }) },
  deps: boundary.trusted<Deps>(),
  concurrency: 2,
})

export const pipeline = s.steps(
  {
    ingest: s.task(
      ({ context, deps, update }) => {
        const { rows } = deps.source.fetch(context.source)
        update({ rows })
        return { rows }
      },
      { retry: { attempts: 2, backoff: 800 }, next: ['normalize', 'enrich'] },
    ),
    normalize: s.task(
      async ({ context, deps, update }) => {
        const { normalized } = await deps.normalizer.run(context.rows)
        update({ normalized })
        return { normalized }
      },
      { next: 'gate' },
    ),
    enrich: s.task(
      async ({ context, deps, update }) => {
        const { enriched, quality } = await deps.enricher.run(context.rows)
        update({ enriched, quality })
        return { enriched, quality }
      },
      {
        when: ({ context }) => context.enrichment === 'on',
        retry: { attempts: 1, backoff: 1_200 }, // the fake enricher fails once → `retrying` in the graph
        next: 'gate',
      },
    ),
    gate: s.decision({
      dependsOn: ['normalize', 'enrich'],
      next: ({ context }) =>
        context.enrichment === 'off' || context.quality >= 0.8 ? 'approve' : 'quarantine',
    }),
    approve: s.wait({
      on: { 'review.approved': ({ payload, update }) => update({ approvedBy: payload.by }) },
      timeout: { after: '2m', next: 'quarantine' },
      next: 'persist',
    }),
    persist: s.task(
      ({ context, deps }) =>
        deps.warehouse.write({
          normalized: context.normalized ?? 0,
          enriched: context.enriched ?? 0,
        }),
      { next: 'done' },
    ),
    quarantine: s.final({ output: ({ context }) => `quarantined (quality ${context.quality})` }),
    done: s.final({
      output: ({ context }) =>
        `stored ${context.rows} rows, approved by ${context.approvedBy ?? '?'}`,
    }),
  },
  { start: 'ingest' },
)

/** Fake services that take real time (so the graph animates); `enricher` fails the first call. */
export function makeDeps(delayMs = 900): Deps {
  let enrichCalls = 0
  const after = <T>(value: T): Promise<T> => new Promise((r) => setTimeout(() => r(value), delayMs))
  return {
    source: { fetch: () => ({ rows: 100 }) },
    normalizer: { run: (rows) => after({ normalized: rows }) },
    enricher: {
      run: async (rows) => {
        enrichCalls += 1
        if (enrichCalls === 1) throw new Error('enrichment service warming up (simulated)')
        return after({ enriched: rows, quality: 0.9 })
      },
    },
    warehouse: { write: () => ({ batchId: 'b-1' }) },
  }
}

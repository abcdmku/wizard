/**
 * Example 07's ingest pipeline (`ingest → (normalize ∥ enrich) → gate → persist → done`, with
 * `when` on the enrichment branch and an AND-join decision) plus one addition so the page has
 * an external event to send: an `approve` wait step (with a timeout) before `persist`.
 */
import { boundary, defineWizard } from '@openwizard/core'
import { z } from 'zod'

export interface Deps {
  source: { fetch(name: string): { rows: number } }
  normalizer: { run(rows: number): Promise<{ normalized: number }> }
  enricher: { run(rows: number): Promise<{ enriched: number; quality: number }> }
  warehouse: { write(batch: { normalized: number; enriched: number }): { batchId: string } }
}

export const pipeline = defineWizard(
  {
    name: 'ingest-pipeline',
    description:
      'Ingests rows, normalizes and enriches them, then stores them once a person approves.',
    version: 2,
    context: z.object({
      source: z.string(),
      enrichment: z.enum(['on', 'off']).default('on'),
    }),
    events: { 'review.approved': z.object({ by: z.string().min(1) }) },
    deps: boundary.trusted<Deps>(),
    concurrency: 2,
  },
  ({ step, steps }) => {
    const ingest = step({
      description: 'Fetches the source and reports how many rows it holds.',
      run: ({ context, deps }) => deps.source.fetch(context.source),
      retry: { retries: 2, backoff: 800 },
    })
    const normalize = step({
      needs: { ingest },
      run: ({ needs, deps }) => deps.normalizer.run(needs.ingest.rows),
    })
    const enrich = step({
      needs: { ingest },
      run: ({ needs, deps }) => deps.enricher.run(needs.ingest.rows),
      when: ({ context }) => context.enrichment === 'on',
      retry: { retries: 1, backoff: 1_200 }, // the fake enricher fails once → `retrying` in the graph
    })
    const gate = step({
      description: 'Asks for approval unless enrichment ran and scored below 0.8.',
      // The optional need lets the gate run when enrichment is switched off and skipped.
      needs: { normalize, enrich: { optional: enrich } },
      targets: ['approve', 'quarantine'],
      next: ({ context, needs }) =>
        context.enrichment === 'off' || (needs.enrich?.quality ?? 0) >= 0.8
          ? 'approve'
          : 'quarantine',
    })
    const approve = step({
      description: 'Waits two minutes for a reviewer. Its output names who approved.',
      waitFor: { 'review.approved': ({ payload }) => ({ done: payload }) },
      timeout: { after: '2m', next: 'quarantine' },
    })
    // A timed-out approval is skipped, so persist and done, which need it, are skipped too.
    const persist = step({
      needs: { approve, normalize, enrich: { optional: enrich } },
      run: ({ needs, deps }) =>
        deps.warehouse.write({
          normalized: needs.normalize.normalized,
          enriched: needs.enrich?.enriched ?? 0,
        }),
    })
    const quarantine = step({
      description: 'Reports the quality score of a batch that was not stored.',
      needs: { enrich: { optional: enrich } },
      run: ({ needs }) => `quarantined (quality ${needs.enrich?.quality ?? 0})`,
    })
    const done = step({
      needs: { ingest, approve, persist },
      run: ({ needs }) => `stored ${needs.ingest.rows} rows, approved by ${needs.approve.by}`,
    })
    return steps(
      { ingest, normalize, enrich, gate, approve, persist, quarantine, done },
      { start: 'ingest' },
    )
  },
)

/** Fake services that take real time (so the graph animates); `enricher` fails the first call. */
export function makeDeps(delayMs = 900): Deps {
  let enrichCalls = 0
  const after = <T>(value: T): Promise<T> =>
    new Promise((resolve) => setTimeout(() => resolve(value), delayMs))
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

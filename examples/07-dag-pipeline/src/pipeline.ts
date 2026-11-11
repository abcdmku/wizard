import { boundary, defineWizard } from '@openwizard/core'
import { z } from 'zod'

export interface Deps {
  source: { fetch(name: string): { rows: number } }
  normalizer: { run(rows: number): Promise<{ normalized: number }> }
  enricher: { run(rows: number): Promise<{ enriched: number; quality: number }> }
  warehouse: { write(batch: { normalized: number; enriched: number }): { batchId: string } }
}

/** Build the same graph with different execution policies. */
export function definePipeline(policies: { concurrency: number; autoRun?: 'ready' | 'manual' }) {
  return defineWizard(
    {
      name: 'ingest-pipeline',
      description:
        'Ingests rows, normalizes and enriches them in parallel, then stores or quarantines them.',
      context: z.object({
        source: z.string(),
        enrichment: z.enum(['on', 'off']).default('on'),
      }),
      deps: boundary.trusted<Deps>(),
      concurrency: policies.concurrency,
      // Manual mode parks ready tasks until the host calls startReady().
      ...(policies.autoRun !== undefined ? { autoRun: policies.autoRun } : {}),
    },
    ({ step, steps }) => {
      const ingest = step({
        description: 'Fetches the source and reports how many rows it holds.',
        run: ({ context, deps }) => deps.source.fetch(context.source),
      })
      // needs activates a consumer and supplies its typed producer output.
      // Ingest does not need explicit next edges to start both branches.
      const normalize = step({
        needs: { ingest },
        run: ({ needs, deps }) => deps.normalizer.run(needs.ingest.rows),
      })
      const enrich = step({
        needs: { ingest },
        when: ({ context }) => context.enrichment === 'on',
        run: ({ needs, deps }) => deps.enricher.run(needs.ingest.rows),
      })
      const gate = step({
        description: 'Stores the batch unless enrichment ran and scored below 0.8.',
        // Optional needs wait for the producer to settle and return undefined if it was skipped.
        // A plain enrich need would skip this join when enrichment is disabled.
        needs: { normalize, enrichment: { optional: enrich } },
        targets: ['persist', 'quarantine'],
        next: ({ context, needs }) =>
          context.enrichment === 'off' || (needs.enrichment?.quality ?? 0) >= 0.8
            ? 'persist'
            : 'quarantine',
      })
      // The gate starts persist or quarantine. Their needs supply the branch results.
      const persist = step({
        needs: { normalize, enrichment: { optional: enrich } },
        run: ({ needs, deps }) =>
          deps.warehouse.write({
            normalized: needs.normalize.normalized,
            enriched: needs.enrichment?.enriched ?? 0,
          }),
      })
      const quarantine = step({
        description: 'Reports the quality score that kept the batch out of the warehouse.',
        needs: { enrichment: { optional: enrich } },
        run: ({ needs }) => `quarantined (quality ${needs.enrichment?.quality ?? 0})`,
      })
      const done = step({
        description: 'Reports the stored row count. It is skipped when persist is skipped.',
        needs: { ingest, persist },
        run: ({ needs }) => `stored ${needs.ingest.rows} rows`,
      })
      return steps(
        { ingest, normalize, enrich, gate, persist, quarantine, done },
        { start: 'ingest' },
      )
    },
  )
}

/** The default pipeline lets both branches run together. */
export const pipeline = definePipeline({ concurrency: 2 })

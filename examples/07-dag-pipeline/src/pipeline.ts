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
      context: z.object({
        source: z.string(),
        rows: z.number().int().nonnegative().default(0),
        normalized: z.number().int().nonnegative().optional(),
        enriched: z.number().int().nonnegative().optional(),
        quality: z.number().min(0).max(1).default(0),
        enrichment: z.enum(['on', 'off']).default('on'),
      }),
      deps: boundary.trusted<Deps>(),
      concurrency: policies.concurrency,
      // Manual mode parks ready tasks until the host calls startReady().
      ...(policies.autoRun !== undefined ? { autoRun: policies.autoRun } : {}),
    },
    ({ step, steps }) => {
      const ingest = step({
        run: ({ context, deps, update }) => {
          const { rows } = deps.source.fetch(context.source)
          update({ rows })
          return { rows }
        },
      })
      // needs activates a consumer and supplies its typed producer output.
      // Ingest does not need explicit next edges to start both branches.
      const normalize = step({
        needs: { ingest },
        run: async ({ needs, deps, update }) => {
          const { normalized } = await deps.normalizer.run(needs.ingest.rows)
          update({ normalized })
          return { normalized }
        },
      })
      const enrich = step({
        needs: { ingest },
        when: ({ context }) => context.enrichment === 'on',
        run: async ({ needs, deps, update }) => {
          const { enriched, quality } = await deps.enricher.run(needs.ingest.rows)
          update({ enriched, quality })
          return { enriched, quality }
        },
      })
      const gate = step({
        // Optional needs wait for the producer to settle and return undefined if it was skipped.
        // A plain enrich need would skip this join when enrichment is disabled.
        needs: { normalize, enrichment: { optional: enrich } },
        targets: ['persist', 'quarantine'],
        next: ({ context, needs }) =>
          context.enrichment === 'off' || (needs.enrichment?.quality ?? 0) >= 0.8
            ? 'persist'
            : 'quarantine',
      })
      return steps(
        {
          ingest,
          normalize,
          enrich,
          gate,
          persist: step({
            run: ({ context, deps }) =>
              deps.warehouse.write({
                normalized: context.normalized ?? 0,
                enriched: context.enriched ?? 0,
              }),
            next: 'done',
          }),
          quarantine: step({ run: ({ context }) => `quarantined (quality ${context.quality})` }),
          done: step({ run: ({ context }) => `stored ${context.rows} rows` }),
        },
        { start: 'ingest' },
      )
    },
  )
}

/** The default pipeline lets both branches run together. */
export const pipeline = definePipeline({ concurrency: 2 })

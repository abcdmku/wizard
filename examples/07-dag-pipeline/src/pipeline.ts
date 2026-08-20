import { boundary, defineFlow } from '@openwizard/core'
import { z } from 'zod'

export interface Deps {
  source: { fetch(name: string): { rows: number } }
  normalizer: { run(rows: number): Promise<{ normalized: number }> }
  enricher: { run(rows: number): Promise<{ enriched: number; quality: number }> }
  warehouse: { write(batch: { normalized: number; enriched: number }): { batchId: string } }
}

/** Build the same graph with different execution policies. */
export function definePipeline(policies: { concurrency: number; autoRun?: 'ready' | 'manual' }) {
  const ingestPipeline = defineFlow({
    name: 'ingest-pipeline',
    context: z.object({
      source: z.string(),
      // Each branch writes different keys into the shared context.
      rows: z.number().int().nonnegative().default(0),
      normalized: z.number().int().nonnegative().optional(),
      enriched: z.number().int().nonnegative().optional(),
      quality: z.number().min(0).max(1).default(0),
      // 'off' skips the enrichment branch (see `when` on `enrich` below).
      enrichment: z.enum(['on', 'off']).default('on'),
    }),
    deps: boundary.trusted<Deps>(), // built by the host, no runtime check
    // At most `concurrency` tasks run at the same time; the rest stay ready until a slot frees.
    concurrency: policies.concurrency,
    // 'ready' (default) starts ready non-view steps automatically; 'manual' waits for runReady().
    ...(policies.autoRun !== undefined ? { autoRun: policies.autoRun } : {}),
  })

  return ingestPipeline.steps(
    {
      ingest: ingestPipeline.task(
        ({ context, deps, update }) => {
          const { rows } = deps.source.fetch(context.source)
          update({ rows })
          return { rows }
        },
        // An array of targets starts both branches.
        { next: ['normalize', 'enrich'] },
      ),
      normalize: ingestPipeline.task(
        async ({ context, deps, update }) => {
          const { normalized } = await deps.normalizer.run(context.rows)
          update({ normalized })
          return { normalized }
        },
        { next: 'gate' },
      ),
      enrich: ingestPipeline.task(
        async ({ context, deps, update }) => {
          const { enriched, quality } = await deps.enricher.run(context.rows)
          update({ enriched, quality })
          return { enriched, quality }
        },
        {
          // A false `when` skips the branch but still satisfies the join.
          when: ({ context }) => context.enrichment === 'on',
          next: 'gate',
        },
      ),
      // The gate activates from either branch and becomes ready after both finish.
      gate: ingestPipeline.decision({
        dependsOn: ['normalize', 'enrich'],
        next: ({ context }) =>
          context.enrichment === 'off' || context.quality >= 0.8 ? 'persist' : 'quarantine',
      }),
      persist: ingestPipeline.task(
        ({ context, deps }) =>
          deps.warehouse.write({
            normalized: context.normalized ?? 0,
            enriched: context.enriched ?? 0,
          }),
        { next: 'done' },
      ),
      quarantine: ingestPipeline.final({
        output: ({ context }) => `quarantined (quality ${context.quality})`,
      }),
      done: ingestPipeline.final({ output: ({ context }) => `stored ${context.rows} rows` }),
    },
    { start: 'ingest' },
  )
}

/** The default pipeline: two branches may run at once, everything auto-runs. */
export const pipeline = definePipeline({ concurrency: 2 })

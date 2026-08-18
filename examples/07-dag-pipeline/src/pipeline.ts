import { boundary, defineFlow } from '@openwizard/core'
import { z } from 'zod'

/** Pipeline services; the slow ones are async so branches can overlap. */
export interface Deps {
  source: { fetch(name: string): { rows: number } }
  normalizer: { run(rows: number): Promise<{ normalized: number }> }
  enricher: { run(rows: number): Promise<{ enriched: number; quality: number }> }
  warehouse: { write(batch: { normalized: number; enriched: number }): { batchId: string } }
}

/**
 * The pipeline as a function of its policies so the tests can show `concurrency` and
 * `autoRun: 'manual'` on the same graph. Steps and edges are identical in every variant.
 */
export function definePipeline(policies: { concurrency: number; autoRun?: 'ready' | 'manual' }) {
  const s = defineFlow({
    name: 'ingest-pipeline',
    context: z.object({
      source: z.string(),
      // Every branch writes its own keys into the shared context (shallow-merged patches).
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

  return s.steps(
    {
      ingest: s.task(
        ({ context, deps, update }) => {
          const { rows } = deps.source.fetch(context.source)
          update({ rows })
          return { rows }
        },
        // `next` is a NAVIGATION edge: fan-out arrives at both branches, which then run in parallel.
        { next: ['normalize', 'enrich'] },
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
          // `when` (v0.2) is evaluated once the step is ready: `false` skips it
          // (`step.skipped { reason: 'when' }`) — a skipped step counts as done for `dependsOn`
          // and its `next` targets are still arrived, so the gate below is not stuck.
          when: ({ context }) => context.enrichment === 'on',
          next: 'gate',
        },
      ),
      // `dependsOn` is DATA READINESS: the gate is arrived by whichever branch finishes first,
      // but only becomes ready once BOTH are done (an AND-join; `{ any: [...] }` would be OR).
      gate: s.decision({
        dependsOn: ['normalize', 'enrich'],
        next: ({ context }) =>
          context.enrichment === 'off' || context.quality >= 0.8 ? 'persist' : 'quarantine',
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
      done: s.final({ output: ({ context }) => `stored ${context.rows} rows` }),
    },
    { start: 'ingest' },
  )
}

/** The default pipeline: two branches may run at once, everything auto-runs. */
export const pipeline = definePipeline({ concurrency: 2 })

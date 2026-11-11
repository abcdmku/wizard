import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const ingestFlow = defineWizard(
  {
    name: 'ingest',
    context: z.object({
      rows: z.number().int().default(0),
      enrichment: z.enum(['on', 'off']).default('on'),
    }),
    concurrency: 2,
  },
  ({ step, steps }) => {
    const normalize = step({ run: async ({ context }) => ({ normalized: context.rows }) })
    const enrich = step({
      run: async ({ context }) => ({ enriched: context.rows }),
      when: ({ context }) => context.enrichment === 'on',
    })
    // The gate waits for both branches. The optional need lets it run when enrich is skipped.
    const gate = step({ needs: { normalize, enrich: { optional: enrich } }, next: 'done' })
    return steps(
      {
        fetch: step({
          run: async ({ update }) => update({ rows: 100 }),
          next: ['normalize', 'enrich'],
        }),
        normalize,
        enrich,
        gate,
        done: step({ run: ({ context }) => `stored ${context.rows} rows` }),
      },
      { start: 'fetch' },
    )
  },
)

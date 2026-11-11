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
  ({ step, steps }) =>
    steps(
      {
        fetch: step({
          run: async ({ update }) => update({ rows: 100 }),
          next: ['normalize', 'enrich'],
        }),
        normalize: step({
          run: async ({ context }) => ({ normalized: context.rows }),
          next: 'gate',
        }),
        enrich: step({
          run: async ({ context }) => ({ enriched: context.rows }),
          when: ({ context }) => context.enrichment === 'on',
          next: 'gate',
        }),
        // dependsOn gates an already-activated node; skipped dependencies satisfy this gate.
        gate: step({ dependsOn: ['normalize', 'enrich'], next: 'done' }),
        done: step({ run: ({ context }) => `stored ${context.rows} rows` }),
      },
      { start: 'fetch' },
    ),
)

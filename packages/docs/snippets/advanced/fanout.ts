import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const ingestFlow = defineWizard(
  {
    name: 'ingest',
    context: z.object({ enrichment: z.enum(['on', 'off']).default('on') }),
    concurrency: 2,
  },
  ({ step, steps }) => {
    const fetch = step({ run: async () => ({ rows: 100 }) })
    // Both branches need the fetched rows, so they start together once `fetch` is done.
    const normalize = step({
      needs: { fetch },
      run: async ({ needs }) => ({ normalized: needs.fetch.rows }),
    })
    const enrich = step({
      needs: { fetch },
      when: ({ context }) => context.enrichment === 'on',
      run: async ({ needs }) => ({ enriched: needs.fetch.rows }),
    })
    // The join waits for both branches. The optional need lets it run when enrich is skipped.
    const done = step({
      needs: { normalize, enrich: { optional: enrich } },
      run: ({ needs }) => `stored ${needs.normalize.normalized} rows`,
    })
    return steps({ fetch, normalize, enrich, done })
  },
)

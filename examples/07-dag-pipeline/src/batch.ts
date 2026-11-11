import { boundary, defineWizard } from '@openwizard/core'
import { z } from 'zod'

export interface BatchDeps {
  convert(item: { id: string; value: number }): Promise<number>
}

export const batch = defineWizard(
  {
    name: 'convert-batch',
    context: z.object({ items: z.array(z.object({ id: z.string(), value: z.number() })) }),
    deps: boundary.trusted<BatchDeps>(),
  },
  ({ step, steps }) => {
    const converted = step({
      // Items are snapshotted at activation, with stable keys used by retries and snapshots.
      each: ({ context }) => context.items,
      key: (item) => item.id,
      concurrency: 2,
      run: ({ item, deps }) => deps.convert(item),
    })
    return steps({
      converted,
      total: step({
        needs: { converted },
        run: ({ needs }) => needs.converted.reduce((sum, value) => sum + value, 0),
      }),
    })
  },
)

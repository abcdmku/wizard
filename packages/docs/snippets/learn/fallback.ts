import { boundary, defineWizard } from '@openwizard/core'
import { z } from 'zod'

export interface PriceDeps {
  live: { price(sku: string): Promise<number> }
}

export const price = defineWizard(
  {
    name: 'price',
    context: z.object({ sku: z.string(), listPrice: z.number() }),
    deps: boundary.trusted<PriceDeps>(),
  },
  ({ step, steps }) => {
    const list = step({ run: ({ context }) => context.listPrice })
    const live = step({
      run: ({ context, deps }) => deps.live.price(context.sku),
      fallback: list,
    })
    const quote = step({
      needs: { amount: { any: [live, list] } },
      run: ({ needs }) => `Price: ${needs.amount}`,
    })
    return steps({ live, list, quote })
  },
)

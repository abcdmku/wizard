import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const quote = defineWizard(
  { name: 'quote', context: z.object({ provider: z.enum(['primary', 'backup']) }) },
  ({ step, steps }) => {
    const primary = step({ run: () => ({ amount: 40 }) })
    const backup = step({ run: () => ({ amount: 45 }) })
    const choose = step({
      targets: [primary, backup],
      next: ({ context }) => (context.provider === 'primary' ? primary : backup),
    })
    const total = step({
      needs: { chosen: { any: [primary, backup] }, backup: { optional: backup } },
      run: ({ needs }) => ({
        amount: needs.chosen.amount,
        usedBackup: needs.backup !== undefined,
      }),
    })
    return steps({ choose, primary, backup, total })
  },
)

export const batch = defineWizard(
  { name: 'batch', context: z.object({ ids: z.array(z.string()) }) },
  ({ step, steps }) =>
    steps({
      fetch: step({
        each: ({ context }) => context.ids,
        key: (item) => item,
        concurrency: 4,
        run: async ({ item, index, progress }) => {
          progress({ id: item, phase: 'fetching' })
          return { id: item, position: index }
        },
        retry: { attempts: 2, backoff: 100 },
      }),
    }),
)

export const delayed = defineWizard({ name: 'delayed', context: z.object({}) }, ({ step, steps }) =>
  steps({
    pause: step({ sleep: '5m', next: 'done' }),
    done: step({ run: () => 'ready' }),
  }),
)

export const cached = defineWizard(
  { name: 'cached', context: z.object({ cachedValue: z.string() }) },
  ({ step, steps }) => {
    const cache = step({ run: ({ context }) => context.cachedValue })
    const remote = step({
      run: async () => {
        throw new Error('remote unavailable')
      },
      retry: { attempts: 2, backoff: 100 },
      fallback: cache,
    })
    return steps({ remote, cache })
  },
)

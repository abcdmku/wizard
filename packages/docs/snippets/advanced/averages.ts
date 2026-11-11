import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const ingest = defineWizard(
  { name: 'ingest', context: z.object({ rows: z.array(z.number()) }) },
  ({ step, steps }) => {
    const sum = step({ run: ({ context }) => context.rows.reduce((a, b) => a + b, 0) })
    const count = step({ run: ({ context }) => context.rows.length })
    const average = step({
      needs: { sum, count },
      run: ({ needs }) => (needs.count === 0 ? null : needs.sum / needs.count),
    })
    return steps({ sum, count, average }, { start: ['sum', 'count'] })
  },
)

import { boundary, defineFlow } from '@openwizard/core'
import { z } from 'zod'

/** The accounting system we post to — flaky, so the task retries. */
export interface Deps {
  ledger: { post(invoiceId: string, amount: number): Promise<{ ref: string }> }
}

const s = defineFlow({
  name: 'sync-invoice',
  context: z.object({ invoiceId: z.string(), amount: z.number().positive() }),
  deps: boundary.trusted<Deps>(), // built by the host, no runtime check
})

export const syncInvoice = s.steps(
  {
    post: s.task(({ context, deps }) => deps.ledger.post(context.invoiceId, context.amount), {
      // Up to 3 retries after the first failure, spaced 200 ms, 400 ms, 800 ms
      // (`min(baseMs × factor^(attempt-1), maxBackoffMs)`, defaults 200 / 2 / 30 000).
      // The policy is data: it persists with the snapshot and shows up in `inspect()`.
      retry: { attempts: 3, backoff: 'exponential' },
      next: 'done',
    }),
    done: s.final({ output: ({ context }) => `invoice ${context.invoiceId} posted` }),
  },
  { start: 'post' },
)

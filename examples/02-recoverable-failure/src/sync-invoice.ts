import { boundary, defineFlow, type ErrorOf } from '@openwizard/core'
import { z } from 'zod'

export interface Deps {
  ledger: {
    post(
      invoiceId: string,
      amount: number,
      options: { idempotencyKey: string },
    ): Promise<{ ref: string }>
  }
}

export interface LedgerFailure {
  code: 'LEDGER_UNAVAILABLE' | 'REJECTED'
  attempt: number
}

const syncInvoice = defineFlow({
  name: 'sync-invoice',
  context: z.object({ invoiceId: z.string(), amount: z.number().positive() }),
  deps: boundary.trusted<Deps>(), // built by the host, no runtime check
})

export const syncInvoiceFlow = syncInvoice.steps(
  {
    post: syncInvoice.task(
      ({ context, deps, idempotencyKey }) =>
        deps.ledger.post(context.invoiceId, context.amount, { idempotencyKey }),
      {
        // Three retries follow the first call at 200 ms, 400 ms, and 800 ms.
        retry: { attempts: 3, backoff: 'exponential' },
        // Resume restarts this task with the same key if a crash interrupts it.
        idempotent: ({ context }) => `invoice:${context.invoiceId}`,
        // The mapped value is stored as typed, JSON-safe error data.
        mapError: (error, { attempt }): LedgerFailure => ({
          code:
            error instanceof Error && /unavailable/.test(error.message)
              ? 'LEDGER_UNAVAILABLE'
              : 'REJECTED',
          attempt,
        }),
        next: 'done',
      },
    ),
    done: syncInvoice.final({ output: ({ context }) => `invoice ${context.invoiceId} posted` }),
  },
  { start: 'post' },
)

export type PostFailure = ErrorOf<typeof syncInvoiceFlow, 'post'>

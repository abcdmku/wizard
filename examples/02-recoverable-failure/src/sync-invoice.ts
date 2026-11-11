import { boundary, defineWizard, type ErrorOf } from '@openwizard/core'
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

export type LedgerFailure = {
  code: 'LEDGER_UNAVAILABLE' | 'REJECTED'
  attempt: number
}

export const syncInvoiceFlow = defineWizard(
  {
    name: 'sync-invoice',
    context: z.object({ invoiceId: z.string(), amount: z.number().positive() }),
    deps: boundary.trusted<Deps>(), // the host supplies these services
  },
  ({ step, steps }) =>
    steps(
      {
        post: step({
          run: ({ context, deps, idempotencyKey }) =>
            deps.ledger.post(context.invoiceId, context.amount, { idempotencyKey }),
          // Three retries follow the first call at 200 ms, 400 ms, and 800 ms.
          retry: { retries: 3, backoff: 'exponential', baseMs: 200 },
          // Resume restarts this task with the same key if a crash interrupts it.
          idempotencyKey: ({ context }) => `invoice:${context.invoiceId}`,
          // The mapped value is stored as typed, JSON-safe error data.
          mapError: (error, { attempt }): LedgerFailure => ({
            code:
              error instanceof Error && /unavailable/.test(error.message)
                ? 'LEDGER_UNAVAILABLE'
                : 'REJECTED',
            attempt,
          }),
          next: 'done',
        }),
        done: step({ run: ({ context }) => `invoice ${context.invoiceId} posted` }),
      },
      { start: 'post' },
    ),
)

export type PostFailure = ErrorOf<typeof syncInvoiceFlow, 'post'>

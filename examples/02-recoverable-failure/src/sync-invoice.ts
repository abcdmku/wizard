import { boundary, defineFlow, type ErrorOf } from '@openwizard/core'
import { z } from 'zod'

/** The accounting system we post to — flaky, so the task retries. */
export interface Deps {
  ledger: {
    /** `idempotencyKey` lets the ledger de-duplicate a re-run of the same posting. */
    post(
      invoiceId: string,
      amount: number,
      opts: { idempotencyKey: string },
    ): Promise<{ ref: string }>
  }
}

/** The ledger's failures as the flow records them (`steps.post.error.data`, JSON-safe). */
export interface LedgerFailure {
  code: 'LEDGER_UNAVAILABLE' | 'REJECTED'
  attempt: number
}

const s = defineFlow({
  name: 'sync-invoice',
  context: z.object({ invoiceId: z.string(), amount: z.number().positive() }),
  deps: boundary.trusted<Deps>(), // built by the host, no runtime check
})

export const syncInvoice = s.steps(
  {
    post: s.task(
      ({ context, deps, idempotencyKey }) =>
        deps.ledger.post(context.invoiceId, context.amount, { idempotencyKey }),
      {
        // Up to 3 retries after the first failure, spaced 200 ms, 400 ms, 800 ms
        // (`min(baseMs × factor^(attempt-1), maxBackoffMs)`, defaults 200 / 2 / 30 000).
        // The policy is data: it persists with the snapshot and shows up in `inspect()`.
        retry: { attempts: 3, backoff: 'exponential' },
        // v0.2: an idempotent task is RE-RUN with the same key after a crash (resume finds it
        // `running`) instead of failing `interrupted`; the key is `args.idempotencyKey`.
        idempotent: ({ context }) => `invoice:${context.invoiceId}`,
        // v0.2: map the raw failure to a typed, JSON-safe value → `steps.post.error.data`
        // (`ErrorOf<typeof syncInvoice, 'post'>`), exposable to clients with `error: true`.
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
    done: s.final({ output: ({ context }) => `invoice ${context.invoiceId} posted` }),
  },
  { start: 'post' },
)

/** The typed error extractor in action: exactly the `mapError` return type. */
export type PostFailure = ErrorOf<typeof syncInvoice, 'post'>

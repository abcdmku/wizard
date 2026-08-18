import { boundary, defineFlow } from '@openwizard/core'
import { z } from 'zod'

/** The notification service that asks a manager for a decision. */
export interface Deps {
  notifier: { requestApproval(requestId: string, amount: number): Promise<{ ticket: string }> }
}

const Decision = z.object({ approved: z.boolean(), by: z.string() })

const s = defineFlow({
  name: 'expense-approval',
  version: 1, // part of the persistence identity together with `name`
  context: z.object({
    requestId: z.string(),
    amount: z.number().positive(),
    decision: Decision.optional(), // filled by the `approval.decided` handler
  }),
  events: { 'approval.decided': Decision }, // the webhook body goes through this boundary
  deps: boundary.trusted<Deps>(), // built by the host, no runtime check
})

export const approval = s.steps(
  {
    // An async task: if the process dies while it runs, the snapshot says "active" and resume
    // turns that into `step.failed { kind: 'interrupted' }` (re-run explicitly with `retry()`).
    notify: s.task(
      ({ context, deps }) => deps.notifier.requestApproval(context.requestId, context.amount),
      {
        next: 'awaitDecision',
      },
    ),
    // A wait step: the deadline is absolute state, so a resumed instance re-arms it — or fires
    // it immediately when it is already overdue.
    awaitDecision: s.wait({
      on: { 'approval.decided': ({ payload, update }) => update({ decision: payload }) },
      timeout: { after: '48h', next: 'expired' },
      next: 'route',
    }),
    route: s.decision({
      next: ({ context }) => (context.decision?.approved ? 'approved' : 'rejected'),
    }),
    approved: s.final({ output: ({ context }) => `approved by ${context.decision?.by}` }),
    rejected: s.final({ output: ({ context }) => `rejected by ${context.decision?.by}` }),
    expired: s.final({ output: () => 'expired: nobody decided within 48h' }),
  },
  { start: 'notify' },
)

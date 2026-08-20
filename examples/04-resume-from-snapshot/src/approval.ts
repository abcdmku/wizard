import { boundary, defineFlow } from '@openwizard/core'
import { z } from 'zod'

export interface Deps {
  notifier: { requestApproval(requestId: string, amount: number): Promise<{ ticket: string }> }
}

const Decision = z.object({ approved: z.boolean(), by: z.string() })

const expenseApproval = defineFlow({
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

export const approval = expenseApproval.steps(
  {
    // Resume marks an interrupted non-idempotent task as failed so the host can retry it.
    notify: expenseApproval.task(
      ({ context, deps }) => deps.notifier.requestApproval(context.requestId, context.amount),
      {
        next: 'awaitDecision',
      },
    ),
    // The absolute deadline survives a snapshot and resume.
    awaitDecision: expenseApproval.wait({
      on: { 'approval.decided': ({ payload, update }) => update({ decision: payload }) },
      timeout: { after: '48h', next: 'expired' },
      next: 'route',
    }),
    route: expenseApproval.decision({
      next: ({ context }) => (context.decision?.approved ? 'approved' : 'rejected'),
    }),
    approved: expenseApproval.final({
      output: ({ context }) => `approved by ${context.decision?.by}`,
    }),
    rejected: expenseApproval.final({
      output: ({ context }) => `rejected by ${context.decision?.by}`,
    }),
    expired: expenseApproval.final({ output: () => 'expired: nobody decided within 48h' }),
  },
  { start: 'notify' },
)

// v2 adds `currency` to the context. Snapshots persisted by v1 carry `flow.version: 1`, so
// `resumeRun(approvalV2, saved, { migrate })` must convert them first.

const expenseApprovalV2 = defineFlow({
  name: 'expense-approval',
  version: 2, // A v1 snapshot needs `migrate`.
  context: z.object({
    requestId: z.string(),
    amount: z.number().positive(),
    currency: z.enum(['EUR', 'USD']), // The migration must supply this new field.
    decision: Decision.optional(),
  }),
  events: { 'approval.decided': Decision },
  deps: boundary.trusted<Deps>(),
})

export const approvalV2 = expenseApprovalV2.steps(
  {
    notify: expenseApprovalV2.task(
      ({ context, deps }) => deps.notifier.requestApproval(context.requestId, context.amount),
      { next: 'awaitDecision' },
    ),
    awaitDecision: expenseApprovalV2.wait({
      on: { 'approval.decided': ({ payload, update }) => update({ decision: payload }) },
      timeout: { after: '48h', next: 'expired' },
      next: 'route',
    }),
    route: expenseApprovalV2.decision({
      next: ({ context }) => (context.decision?.approved ? 'approved' : 'rejected'),
    }),
    approved: expenseApprovalV2.final({
      output: ({ context }) => `approved by ${context.decision?.by} (${context.currency})`,
    }),
    rejected: expenseApprovalV2.final({
      output: ({ context }) => `rejected by ${context.decision?.by}`,
    }),
    expired: expenseApprovalV2.final({ output: () => 'expired: nobody decided within 48h' }),
  },
  { start: 'notify' },
)

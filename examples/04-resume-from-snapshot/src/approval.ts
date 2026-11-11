import { boundary, defineWizard } from '@openwizard/core'
import { z } from 'zod'

export interface Deps {
  notifier: { requestApproval(requestId: string, amount: number): Promise<{ ticket: string }> }
}

const Decision = z.object({ approved: z.boolean(), by: z.string() })

export const approval = defineWizard(
  {
    name: 'expense-approval',
    version: 1, // part of the persistence identity together with `name`
    context: z.object({
      requestId: z.string(),
      amount: z.number().positive(),
      decision: Decision.optional(),
    }),
    events: { 'approval.decided': Decision },
    deps: boundary.trusted<Deps>(),
  },
  ({ step, steps }) =>
    steps(
      {
        // Resume fails interrupted non-idempotent work so the host can decide whether to retry.
        notify: step({
          run: ({ context, deps }) =>
            deps.notifier.requestApproval(context.requestId, context.amount),
          next: 'awaitDecision',
        }),
        // The absolute deadline survives a snapshot and resume.
        awaitDecision: step({
          waitFor: {
            'approval.decided': ({ payload, update }) => {
              update({ decision: payload })
              return { done: payload }
            },
          },
          timeout: { after: '48h', next: 'expired' },
          next: 'route',
        }),
        route: step({
          targets: ['approved', 'rejected'],
          next: ({ context }) => (context.decision?.approved ? 'approved' : 'rejected'),
        }),
        approved: step({ run: ({ context }) => `approved by ${context.decision?.by}` }),
        rejected: step({ run: ({ context }) => `rejected by ${context.decision?.by}` }),
        expired: step({ run: () => 'expired: nobody decided within 48h' }),
      },
      { start: 'notify' },
    ),
)

// V2 adds currency. approvalV2.resume(saved, { migrate }) converts V1 snapshots before use.
export const approvalV2 = defineWizard(
  {
    name: 'expense-approval',
    version: 2,
    context: z.object({
      requestId: z.string(),
      amount: z.number().positive(),
      currency: z.enum(['EUR', 'USD']),
      decision: Decision.optional(),
    }),
    events: { 'approval.decided': Decision },
    deps: boundary.trusted<Deps>(),
  },
  ({ step, steps }) =>
    steps(
      {
        notify: step({
          run: ({ context, deps }) =>
            deps.notifier.requestApproval(context.requestId, context.amount),
          next: 'awaitDecision',
        }),
        awaitDecision: step({
          waitFor: {
            'approval.decided': ({ payload, update }) => {
              update({ decision: payload })
              return { done: payload }
            },
          },
          timeout: { after: '48h', next: 'expired' },
          next: 'route',
        }),
        route: step({
          targets: ['approved', 'rejected'],
          next: ({ context }) => (context.decision?.approved ? 'approved' : 'rejected'),
        }),
        approved: step({
          run: ({ context }) => `approved by ${context.decision?.by} (${context.currency})`,
        }),
        rejected: step({ run: ({ context }) => `rejected by ${context.decision?.by}` }),
        expired: step({ run: () => 'expired: nobody decided within 48h' }),
      },
      { start: 'notify' },
    ),
)

import { boundary, defineWizard } from '@openwizard/core'
import { z } from 'zod'

export interface Deps {
  notifier: { requestApproval(requestId: string, amount: number): Promise<{ ticket: string }> }
}

const Decision = z.object({ approved: z.boolean(), by: z.string() })

export const approval = defineWizard(
  {
    name: 'expense-approval',
    description: 'Asks an approver to decide on an expense and gives up after 48 hours.',
    version: 1, // part of the persistence identity together with `name`
    context: z.object({ requestId: z.string(), amount: z.number().positive() }),
    events: { 'approval.decided': Decision },
    deps: boundary.trusted<Deps>(),
  },
  ({ step, steps }) => {
    // Resume fails interrupted non-idempotent work so the host can decide whether to retry.
    const notify = step({
      description: 'Sends the approval request to the approver.',
      run: ({ context, deps }) => deps.notifier.requestApproval(context.requestId, context.amount),
      next: 'awaitDecision',
    })
    // The absolute deadline survives a snapshot and resume.
    const awaitDecision = step({
      description: 'Waits for the decision. Its output is the decision event.',
      waitFor: { 'approval.decided': ({ payload }) => ({ done: payload }) },
      timeout: { after: '48h', next: 'expired' },
    })
    // A timed-out wait is skipped, so the steps that need the decision are skipped with it.
    const route = step({
      description: 'Picks the approved or the rejected ending.',
      needs: { decision: awaitDecision },
      targets: ['approved', 'rejected'],
      next: ({ needs }) => (needs.decision.approved ? 'approved' : 'rejected'),
    })
    const approved = step({
      needs: { decision: awaitDecision },
      run: ({ needs }) => `approved by ${needs.decision.by}`,
    })
    const rejected = step({
      needs: { decision: awaitDecision },
      run: ({ needs }) => `rejected by ${needs.decision.by}`,
    })
    const expired = step({
      description: 'Ends the run when nobody decided in time.',
      run: () => 'expired: nobody decided within 48h',
    })
    return steps({ notify, awaitDecision, route, approved, rejected, expired }, { start: 'notify' })
  },
)

// V2 adds currency. approvalV2.resume(saved, { migrate }) converts V1 snapshots before use.
export const approvalV2 = defineWizard(
  {
    name: 'expense-approval',
    description: 'The expense approval with a currency, which the approved ending reports.',
    version: 2,
    context: z.object({
      requestId: z.string(),
      amount: z.number().positive(),
      currency: z.enum(['EUR', 'USD']),
    }),
    events: { 'approval.decided': Decision },
    deps: boundary.trusted<Deps>(),
  },
  ({ step, steps }) => {
    const notify = step({
      description: 'Sends the approval request to the approver.',
      run: ({ context, deps }) => deps.notifier.requestApproval(context.requestId, context.amount),
      next: 'awaitDecision',
    })
    const awaitDecision = step({
      description: 'Waits for the decision. Its output is the decision event.',
      waitFor: { 'approval.decided': ({ payload }) => ({ done: payload }) },
      timeout: { after: '48h', next: 'expired' },
    })
    const route = step({
      description: 'Picks the approved or the rejected ending.',
      needs: { decision: awaitDecision },
      targets: ['approved', 'rejected'],
      next: ({ needs }) => (needs.decision.approved ? 'approved' : 'rejected'),
    })
    const approved = step({
      needs: { decision: awaitDecision },
      run: ({ context, needs }) => `approved by ${needs.decision.by} (${context.currency})`,
    })
    const rejected = step({
      needs: { decision: awaitDecision },
      run: ({ needs }) => `rejected by ${needs.decision.by}`,
    })
    const expired = step({
      description: 'Ends the run when nobody decided in time.',
      run: () => 'expired: nobody decided within 48h',
    })
    return steps({ notify, awaitDecision, route, approved, rejected, expired }, { start: 'notify' })
  },
)

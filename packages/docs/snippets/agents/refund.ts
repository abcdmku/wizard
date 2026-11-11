import { boundary, defineWizard } from '@openwizard/core'
import { inspect, toMarkdown } from '@openwizard/core/inspect'
import { z } from 'zod'

/** Services the host supplies. They never enter a snapshot. */
export interface RefundDeps {
  orders: { find(orderId: string): Promise<{ total: number }> }
  payments: {
    refund(
      orderId: string,
      amount: number,
      options: { idempotencyKey: string },
    ): Promise<{ refundId: string }>
  }
}

export const refund = defineWizard(
  {
    name: 'refund',
    description: 'Refunds part of an order. A refund of 100 or more waits for a manager.',
    context: z.object({ orderId: z.string() }),
    deps: boundary.trusted<RefundDeps>(),
    events: { 'refund.approved': z.object({ by: z.string() }) },
  },
  ({ step, view, steps }) => {
    const request = view({
      description: 'The customer says how much to refund and why.',
      input: z.object({ amount: z.number().positive(), reason: z.string().min(1) }),
    })
    const order = step({
      description: 'Loads the order, so the refund cannot exceed what was paid.',
      run: ({ context, deps }) => deps.orders.find(context.orderId),
    })
    const route = step({
      description: 'Sends large refunds to a manager and approves small ones by policy.',
      needs: { request },
      targets: ['managerApproval', 'policyApproval'],
      next: ({ needs }) => (needs.request.amount >= 100 ? 'managerApproval' : 'policyApproval'),
    })
    const managerApproval = step({
      description: 'Waits for a manager to approve the refund.',
      waitFor: { 'refund.approved': ({ payload }) => ({ done: { by: payload.by } }) },
    })
    const policyApproval = step({
      description: 'Approves the refund without a person.',
      run: () => ({ by: 'policy' }),
    })
    const pay = step({
      description: 'Returns the money. The idempotency key makes a repeated call safe.',
      needs: { request, order, approval: { any: [managerApproval, policyApproval] } },
      run: async ({ context, deps, needs, idempotencyKey }) => {
        const amount = Math.min(needs.request.amount, needs.order.total)
        const { refundId } = await deps.payments.refund(context.orderId, amount, { idempotencyKey })
        return { refundId, amount, approvedBy: needs.approval.by }
      },
      idempotencyKey: ({ context }) => `refund:${context.orderId}`,
      retry: { retries: 2, backoff: 'exponential' },
    })
    return steps(
      { request, order, route, managerApproval, policyApproval, pay },
      { start: ['request', 'order'] },
    )
  },
)

/** The page a person or an agent reads to learn what the wizard does. */
export const refundPage = toMarkdown(inspect(refund))

import { boundary, defineWizard } from '@openwizard/core'
import { z } from 'zod'
import { defineDev, devWizard } from '../src/index'

interface RefundDeps {
  orders: { find(orderId: string): Promise<{ total: number }> }
  payments: { refund(orderId: string, amount: number): Promise<{ refundId: string }> }
}

/** A refund with a form, a service call, a branch, an event wait and a join. */
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
      description: 'The customer says how much to refund.',
      input: z.object({ amount: z.number().positive() }),
    })
    const order = step({
      description: 'Loads the order.',
      run: ({ context, deps }) => deps.orders.find(context.orderId),
    })
    const route = step({
      description: 'Sends large refunds to a manager.',
      needs: { request },
      targets: ['managerApproval', 'policyApproval'],
      next: ({ needs }) => (needs.request.amount >= 100 ? 'managerApproval' : 'policyApproval'),
    })
    const managerApproval = step({
      description: 'Waits for a manager.',
      waitFor: { 'refund.approved': ({ payload }) => ({ done: { by: payload.by } }) },
    })
    const policyApproval = step({
      description: 'Approves by policy.',
      run: () => ({ by: 'policy' }),
    })
    const pay = step({
      description: 'Returns the money.',
      needs: { request, order, approval: { any: [managerApproval, policyApproval] } },
      run: async ({ context, deps, needs }) => {
        const amount = Math.min(needs.request.amount, needs.order.total)
        const { refundId } = await deps.payments.refund(context.orderId, amount)
        return { refundId, amount, approvedBy: needs.approval.by }
      },
    })
    return steps(
      { request, order, route, managerApproval, policyApproval, pay },
      { start: ['request', 'order'] },
    )
  },
)

/** A reminder that sleeps for an hour, then runs with real services. */
export const reminder = defineWizard(
  {
    name: 'reminder',
    description: 'Waits an hour, then sends a reminder.',
    context: z.object({ to: z.string() }),
    deps: boundary.trusted<{ mail: { send(to: string): Promise<string> } }>(),
  },
  ({ step, steps }) => {
    const pause = step({ description: 'Waits an hour.', sleep: '1h' })
    const send = step({
      description: 'Sends the reminder.',
      needs: { pause },
      run: ({ context, deps }) => deps.mail.send(context.to),
    })
    return steps({ pause, send })
  },
)

export default defineDev({
  wizards: [
    devWizard(refund, {
      input: { orderId: 'o-2' },
      events: { 'refund.approved': { source: 'webhook', from: 'Back office' } },
    }),
    devWizard(reminder, { deps: { mail: { send: async (to) => `sent to ${to}` } } }),
  ],
})

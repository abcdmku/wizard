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

/** An upload whose one step calls a service and tries three times. */
export const upload = defineWizard(
  {
    name: 'upload',
    description: 'Saves a file, trying again after a failure.',
    context: z.object({ fileId: z.string() }),
    deps: boundary.trusted<{ storage: { save(fileId: string): Promise<{ url: string }> } }>(),
  },
  ({ step, steps }) =>
    steps({
      save: step({
        description: 'Saves the file.',
        run: ({ context, deps }) => deps.storage.save(context.fileId),
        retry: { retries: 2, backoff: 1_000 },
      }),
    }),
)

interface DashboardDeps {
  users: { find(userId: string): Promise<{ name: string }> }
  orders: { list(userId: string): Promise<string[]> }
  audit: { open(userId: string): Promise<string>; close(ticket: string): Promise<null> }
}

/** Two steps that call services at once, and a third that makes two calls in a row. */
export const dashboard = defineWizard(
  {
    name: 'dashboard',
    description: 'Loads a profile and orders at once, then writes an audit entry.',
    context: z.object({ userId: z.string() }),
    deps: boundary.trusted<DashboardDeps>(),
  },
  ({ step, steps }) => {
    const profile = step({
      description: 'Loads the profile.',
      run: ({ context, deps }) => deps.users.find(context.userId),
    })
    const orders = step({
      description: 'Lists the orders.',
      run: ({ context, deps }) => deps.orders.list(context.userId),
    })
    const audit = step({
      description: 'Opens an audit ticket and closes it.',
      needs: { profile, orders },
      run: async ({ context, deps }) => {
        const ticket = await deps.audit.open(context.userId)
        await deps.audit.close(ticket)
        return ticket
      },
    })
    return steps({ profile, orders, audit }, { start: ['profile', 'orders'] })
  },
)

export default defineDev({
  wizards: [
    devWizard(refund, {
      input: { orderId: 'o-2' },
      events: { 'refund.approved': { source: 'webhook', from: 'Back office' } },
      examples: {
        forms: { request: { amount: 900 } },
        events: { 'refund.approved': { by: 'grace' } },
        calls: { 'orders.find': { total: 250 } },
      },
    }),
    devWizard(reminder, { deps: { mail: { send: async (to) => `sent to ${to}` } } }),
    devWizard(upload, { input: { fileId: 'f-1' } }),
    devWizard(dashboard, { input: { userId: '7' } }),
  ],
})

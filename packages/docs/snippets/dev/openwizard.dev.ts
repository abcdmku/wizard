import { defineDev, devWizard } from '@openwizard/dev'
import { refund } from '../agents/refund' // the wizard on the home page
import { approval } from '../learn/wait' // the wizard from Wait for events and time

export default defineDev({
  wizards: [
    devWizard(refund, {
      // The Start form opens with this input.
      input: { orderId: 'o-2' },
      // `orders` is real. `payments` is missing, so each refund waits for your answer.
      deps: { orders: { find: async () => ({ total: 250 }) } },
      // Say where each event comes from, so the UI labels the wait.
      events: { 'refund.approved': { source: 'webhook', from: 'Back office' } },
      // What each editor opens with, so one click sends a valid value.
      examples: {
        forms: { request: { amount: 900, reason: 'never arrived' } },
        events: { 'refund.approved': { by: 'grace' } },
        calls: { 'payments.refund': { refundId: 'refund-1' } },
      },
    }),
    devWizard(approval, {
      events: { approved: { source: 'queue', from: 'approvals topic' } },
      examples: { events: { approved: { by: 'grace' } } },
    }),
  ],
})

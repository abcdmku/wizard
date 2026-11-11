import { createMemoryStore, defineWizard } from '@openwizard/core'
import { orderHeader } from './header'
import { addressStep, auditSteps, paymentSteps } from './step-modules'

/** A wizard assembled from a header object and step modules. */
export const order = defineWizard(orderHeader, (api) => {
  const shipTo = addressStep(api)
  const payment = paymentSteps(api)
  const auditing = auditSteps(api)
  const summary = api.step({
    needs: { shipTo, receipts: { optional: payment.receipts }, audit: auditing.audit },
    run: ({ needs }) => ({ city: needs.shipTo.city, receipts: needs.receipts?.length ?? 0 }),
  })
  return api.steps(
    { shipTo, ...payment, ...auditing, summary },
    { start: ['shipTo', 'charge', 'confirm'] },
  )
})

/** The same wizard with its dependencies bound. */
export const boundOrder = order.provide({
  charge: async (orderId) => ({ paymentId: `p-${orderId}` }),
})

export const store = createMemoryStore()

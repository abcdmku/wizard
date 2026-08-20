import type { FlowRun } from '@openwizard/core'
import type { orderFlow } from './input-order-flow'

export function observeOrder(
  run: FlowRun<typeof orderFlow>,
  onPayment: (paymentId: string) => void,
) {
  return run.observe((event) => {
    if (event.type === 'event.received' && event.event === 'payment.captured') {
      onPayment(event.payload.paymentId)
    }
  })
}

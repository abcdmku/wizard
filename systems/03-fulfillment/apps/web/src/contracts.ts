import {
  type CustomerOrder,
  type CustomerOrderStatus,
  CustomerOrderStatusSchema,
  type OperatorOrder,
  type WorkflowStepSchema,
} from '@fulfillment/contracts'
import { z } from 'zod'

export type {
  CancelOrder,
  CreateOrder,
  CustomerOrder,
  CustomerOrderStatus,
  FraudDecision,
  OperatorOrder,
} from '@fulfillment/contracts'
export {
  CancelOrderSchema,
  CreateOrderSchema,
  CustomerOrderListResponseSchema,
  CustomerOrderResponseSchema,
  CustomerOrderSchema,
  ErrorResponseSchema,
  FraudDecisionSchema,
  OperatorOrderListResponseSchema,
  OperatorOrderResponseSchema,
  OperatorOrderSchema,
} from '@fulfillment/contracts'

export const branchStatusSchema = z.enum([
  'queued',
  'running',
  'waiting',
  'succeeded',
  'failed',
  'compensating',
  'compensated',
  'cancelled',
])

export const displayStatusSchema = z.union([CustomerOrderStatusSchema, branchStatusSchema])

export const branchViewSchema = z.object({
  label: z.string(),
  status: branchStatusSchema,
  message: z.string().optional(),
  attempt: z.number().int().nonnegative().optional(),
  reference: z.string().optional(),
  error: z.string().optional(),
})

export type BranchStatus = z.infer<typeof branchStatusSchema>
export type DisplayStatus = z.infer<typeof displayStatusSchema>
export type BranchView = z.infer<typeof branchViewSchema>
type WorkflowStep = z.infer<typeof WorkflowStepSchema>

export function orderNumber(order: CustomerOrder | OperatorOrder): string {
  return `LS-${order.id.slice(0, 8).toUpperCase()}`
}

export function customerStatusMessage(order: CustomerOrder): string {
  if (order.status === 'processing') return 'Payment and inventory checks are running in parallel.'
  if (order.status === 'fraud_review') return 'Your order needs a quick manual review.'
  if (order.status === 'shipping') return 'Your items are packed. We are waiting for the carrier.'
  if (order.status === 'shipped') return 'Your order is on the way.'
  if (order.status === 'cancelling') return 'We are reversing completed work.'
  if (order.status === 'cancelled') return 'This order was cancelled.'
  return order.issue?.message ?? 'We could not complete this order. Any charge was reversed.'
}

export function customerParallelBranches(order: CustomerOrder): BranchView[] {
  if (order.status === 'processing') {
    return [
      { label: 'Payment', status: 'running', message: 'Authorizing payment' },
      { label: 'Inventory', status: 'running', message: 'Reserving items' },
    ]
  }
  if (order.status === 'failed') {
    const inventoryFailed = order.issue?.code.toLowerCase().includes('inventory') ?? false
    return [
      {
        label: 'Payment',
        status: inventoryFailed ? 'compensated' : 'failed',
        message: inventoryFailed ? 'Charge reversed' : 'Could not authorize',
      },
      {
        label: 'Inventory',
        status: inventoryFailed ? 'failed' : 'cancelled',
        message: inventoryFailed ? 'Could not reserve' : 'Reservation released',
      },
    ]
  }
  if (order.status === 'cancelling' || order.status === 'cancelled') {
    const status = order.status === 'cancelling' ? 'compensating' : 'compensated'
    return [
      { label: 'Payment', status, message: status === 'compensating' ? 'Reversing' : 'Reversed' },
      {
        label: 'Inventory',
        status,
        message: status === 'compensating' ? 'Releasing' : 'Released',
      },
    ]
  }
  return [
    { label: 'Payment', status: 'succeeded', message: 'Authorized' },
    { label: 'Inventory', status: 'succeeded', message: 'Reserved' },
  ]
}

export function customerReviewBranch(order: CustomerOrder): BranchView {
  if (order.status === 'fraud_review') {
    return { label: 'Order review', status: 'waiting', message: 'A specialist is checking it' }
  }
  if (['shipping', 'shipped'].includes(order.status)) {
    return { label: 'Order review', status: 'succeeded', message: 'Approved' }
  }
  return { label: 'Order review', status: 'queued', message: 'Not started' }
}

export function customerShippingBranch(order: CustomerOrder): BranchView {
  if (order.status === 'shipped') {
    return { label: 'Shipping', status: 'succeeded', message: 'Handed to carrier' }
  }
  if (order.status === 'shipping') {
    return { label: 'Shipping', status: 'waiting', message: 'Waiting for carrier confirmation' }
  }
  if (['cancelling', 'cancelled', 'failed'].includes(order.status)) {
    return { label: 'Shipping', status: 'cancelled', message: 'Stopped' }
  }
  return { label: 'Shipping', status: 'queued', message: 'Not started' }
}

export function isCustomerCancellable(status: CustomerOrderStatus): boolean {
  return ['processing', 'fraud_review', 'shipping'].includes(status)
}

export function operatorBranches(order: OperatorOrder): BranchView[] {
  return [
    partnerBranch(order, 'Payment authorization', 'paymentAuthorization', 'authorize-payment'),
    partnerBranch(order, 'Inventory reservation', 'inventoryReservation', 'reserve-inventory'),
  ]
}

function partnerBranch(
  order: OperatorOrder,
  label: string,
  key: 'paymentAuthorization' | 'inventoryReservation',
  stepHint: string,
): BranchView {
  const partner = order.partnerState[key]
  const step = findStep(order, stepHint)
  return branchViewSchema.parse({
    label,
    status: normalizeBranchStatus(partner.state, step),
    message: partner.state.replaceAll('_', ' '),
    attempt: step?.attempt ?? 0,
    reference: partner.id,
    error: step?.error?.message,
  })
}

export function findStep(order: OperatorOrder, hint: string): WorkflowStep | undefined {
  return order.workflow.steps.find((step) => step.id.toLowerCase().includes(hint))
}

export function normalizeBranchStatus(value: string, step?: WorkflowStep): BranchStatus {
  const status = value.toLowerCase()
  if (step?.error || status.includes('fail')) return 'failed'
  if (status.includes('compensat') || status.includes('revers') || status.includes('releas')) {
    return status.includes('complete') || status.includes('success')
      ? 'compensated'
      : 'compensating'
  }
  if (
    status === 'done' ||
    status.includes('success') ||
    status.includes('complete') ||
    status.includes('authorized') ||
    status.includes('reserved')
  ) {
    return 'succeeded'
  }
  if (status.includes('wait') || step?.phase === 'waiting') return 'waiting'
  if (status.includes('cancel')) return 'cancelled'
  if (status.includes('pending') || status.includes('queue') || status.includes('not_'))
    return 'queued'
  return 'running'
}

export function fraudNeedsAction(order: OperatorOrder): boolean {
  return order.status === 'fraud_review' && !['approved', 'rejected'].includes(order.fraud.state)
}

export function operatorCurrentStepLabel(
  status: CustomerOrderStatus,
  current: string | null,
): string {
  if (current !== null) return current
  if (status === 'fraud_review') return 'Fraud review'
  return 'Terminal'
}

export function failureStep(order: OperatorOrder): WorkflowStep | undefined {
  return order.workflow.steps.find((step) => step.error !== undefined)
}

export function compensationSteps(order: OperatorOrder): WorkflowStep[] {
  return order.workflow.steps.filter((step) =>
    ['compensat', 'refund', 'release', 'reverse'].some((part) =>
      step.id.toLowerCase().includes(part),
    ),
  )
}

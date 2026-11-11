import {
  type CustomerOrder,
  CustomerOrderSchema,
  type CustomerOrderStatus,
  type CustomerPrincipal,
  CustomerPrincipalSchema,
  type OperatorOrder,
  OperatorOrderSchema,
  type OperatorPrincipal,
  OperatorPrincipalSchema,
  type PartnerIdentity,
  type PartnerOrder,
  PartnerOrderSchema,
} from '@fulfillment/contracts'
import { boundary, defineProjection, type Snapshot } from '@openwizard/core'
import { z } from 'zod'
import { fulfillmentFlow } from './workflow'

type FulfillmentState = Snapshot<typeof fulfillmentFlow>['state']

export const PartnerViewerSchema = z.object({
  role: z.literal('partner'),
  tenantId: z.string().min(1),
  partner: z.enum(['payment', 'inventory', 'shipping']),
})

export const ViewerSchema = z.discriminatedUnion('role', [
  CustomerPrincipalSchema,
  OperatorPrincipalSchema,
  PartnerViewerSchema,
])

export type PartnerViewer = z.infer<typeof PartnerViewerSchema>
export type Viewer = z.infer<typeof ViewerSchema>

export const customerOrderProjection = defineProjection(fulfillmentFlow, {
  scope: boundary.trusted<CustomerPrincipal>(),
  select: ({ state, scope }) => {
    requireCustomerScope(state, scope)
    return selectCustomerOrder(state)
  },
})

export const operatorOrderProjection = defineProjection(fulfillmentFlow, {
  scope: boundary.trusted<OperatorPrincipal>(),
  select: ({ state, scope }) => {
    requireTenantScope(state, scope.tenantId)
    return selectOperatorOrder(state)
  },
})

export const partnerOrderProjection = defineProjection(fulfillmentFlow, {
  scope: boundary.trusted<PartnerViewer>(),
  select: ({ state, scope }) => {
    requireTenantScope(state, scope.tenantId)
    return selectPartnerOrder(state, scope.partner)
  },
})

export function selectCustomerOrder(state: FulfillmentState): CustomerOrder {
  const context = state.context
  return CustomerOrderSchema.parse({
    id: context.orderId,
    status: customerStatus(state),
    currency: context.currency,
    totalMinor: context.totalMinor,
    lines: context.lines,
    createdAt: context.createdAt,
    updatedAt: context.updatedAt,
    ...(context.shipment.state === 'shipped' &&
    context.shipment.carrier !== undefined &&
    context.shipment.trackingNumber !== undefined &&
    context.shipment.trackingUrl !== undefined
      ? {
          shipment: {
            carrier: context.shipment.carrier,
            trackingNumber: context.shipment.trackingNumber,
            trackingUrl: context.shipment.trackingUrl,
          },
        }
      : {}),
    ...(context.lastFailure === undefined
      ? {}
      : { issue: { code: context.lastFailure.code, message: context.lastFailure.message } }),
  })
}

export function selectOperatorOrder(state: FulfillmentState): OperatorOrder {
  const context = state.context
  const customer = selectCustomerOrder(state)
  const steps = Object.values(state.steps).map((step) => ({
    id: step.id,
    status: step.status,
    attempt: step.attempt,
    ...(step.error === undefined
      ? {}
      : {
          error: {
            ...(step.error.code === undefined ? {} : { code: step.error.code }),
            message: step.error.message,
          },
        }),
  }))
  return OperatorOrderSchema.parse({
    ...customer,
    tenantId: context.tenantId,
    customerId: context.customerId,
    shippingAddress: context.shippingAddress,
    partnerState: {
      paymentAuthorization: context.paymentAuthorization,
      inventoryReservation: context.inventoryReservation,
      paymentCapture: context.paymentCapture,
      shipment: context.shipment,
    },
    fraud: context.fraud,
    workflow: {
      status: state.status,
      current: state.current,
      seq: state.seq,
      bufferedCallbacks: state.inbox.length,
      deadLetter: state.status === 'failed',
      steps,
    },
  })
}

export function selectPartnerOrder(
  state: FulfillmentState,
  partner: PartnerIdentity,
): PartnerOrder {
  const context = state.context
  const resource =
    partner === 'payment'
      ? {
          state: context.paymentCapture.state,
          ...(context.paymentCapture.id === undefined ? {} : { id: context.paymentCapture.id }),
        }
      : partner === 'inventory'
        ? {
            state: context.inventoryReservation.state,
            ...(context.inventoryReservation.id === undefined
              ? {}
              : { id: context.inventoryReservation.id }),
          }
        : {
            state: context.shipment.state,
            ...(context.shipment.shipmentId === undefined
              ? {}
              : { id: context.shipment.shipmentId }),
          }
  return PartnerOrderSchema.parse({
    id: context.orderId,
    tenantId: context.tenantId,
    partner,
    status: state.status,
    resource,
  })
}

export function customerStatus(state: FulfillmentState): CustomerOrderStatus {
  if (state.status === 'compensating') return 'cancelling'
  if (state.status === 'cancelled') return 'cancelled'
  if (state.status === 'failed') return 'failed'
  if (state.context.shipment.state === 'shipped') return 'shipped'
  if (
    state.context.paymentCapture.state === 'captured' ||
    state.context.shipment.state === 'pending'
  ) {
    return 'shipping'
  }
  if (
    state.context.paymentAuthorization.state === 'authorized' &&
    state.context.inventoryReservation.state === 'reserved' &&
    state.context.fraud.state === 'pending'
  ) {
    return 'fraud_review'
  }
  return 'processing'
}

function requireCustomerScope(state: FulfillmentState, scope: CustomerPrincipal): void {
  requireTenantScope(state, scope.tenantId)
  if (state.context.customerId !== scope.subjectId) throw new Error('Projection scope mismatch')
}

function requireTenantScope(state: FulfillmentState, tenantId: string): void {
  if (state.context.tenantId !== tenantId) throw new Error('Projection scope mismatch')
}

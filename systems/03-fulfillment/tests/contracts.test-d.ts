import {
  customerOrderProjection,
  type FraudReviewedEventSchema,
  type FulfillmentContext,
  type FulfillmentFailure,
  type fulfillmentFlow,
} from '@fulfillment/domain'
import {
  boundary,
  type ContextInput,
  type Ctx,
  defineProjection,
  defineWizard,
  type ErrorOf,
  type OutputOf,
  type PayloadOf,
  type ProjectionOutput,
  type ProjectionScope,
  type Run,
  type WizardOutput,
} from '@openwizard/core'
import { expectTypeOf } from 'vitest'
import type { z } from 'zod'
import type {
  AuthPrincipal,
  CreateOrder,
  CustomerOrder,
  CustomerOrderStatus,
  CustomerPrincipal,
  FraudDecision,
  OperatorOrder,
  PartnerCallback,
  ShippingAddress,
} from '../packages/contracts/src'

const customerInput: CreateOrder = {
  currency: 'USD',
  lines: [{ sku: 'sku-1', name: 'Notebook', quantity: 1, unitPriceMinor: 1200 }],
  shippingAddress: {
    recipient: 'Jordan Lee',
    line1: '1 Main Street',
    city: 'Austin',
    region: 'TX',
    postalCode: '78701',
    country: 'US',
  },
}

const address: ShippingAddress = customerInput.shippingAddress
const decision: FraudDecision = { decision: 'approve' }
const customerOrder: CustomerOrder = {
  id: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
  status: 'processing',
  currency: 'USD',
  totalMinor: 1200,
  lines: customerInput.lines,
  createdAt: '2026-08-23T15:00:00.000Z',
  updatedAt: '2026-08-23T15:00:00.000Z',
}

expectTypeOf(address.country).toEqualTypeOf<string>()
expectTypeOf(decision.decision).toEqualTypeOf<'approve' | 'reject'>()
expectTypeOf(customerOrder.status).toEqualTypeOf<CustomerOrderStatus>()
expectTypeOf<AuthPrincipal>().toMatchTypeOf<{ tenantId: string; subjectId: string }>()
expectTypeOf<OperatorOrder>().toHaveProperty('tenantId')
expectTypeOf<OperatorOrder>().toHaveProperty('workflow')
expectTypeOf<FulfillmentContext>().toHaveProperty('paymentAuthorization')
expectTypeOf<FulfillmentContext>().toHaveProperty('inventoryReservation')
expectTypeOf<FulfillmentContext>().toHaveProperty('fraud')
expectTypeOf<FulfillmentFailure>().toMatchTypeOf<{
  code: string
  message: string
  retryable: boolean
}>()

expectTypeOf<Ctx<typeof fulfillmentFlow>>().toEqualTypeOf<FulfillmentContext>()
expectTypeOf<ContextInput<typeof fulfillmentFlow>>().toMatchTypeOf<FulfillmentContext>()
expectTypeOf<OutputOf<typeof fulfillmentFlow, 'requestPaymentAuthorization'>>().toMatchTypeOf<{
  accepted: true
  requestId: string
  duplicate: boolean
}>()
expectTypeOf<
  ErrorOf<typeof fulfillmentFlow, 'requestPaymentAuthorization'>
>().toEqualTypeOf<FulfillmentFailure>()
expectTypeOf<PayloadOf<typeof fulfillmentFlow, 'fraud.reviewed'>>().toEqualTypeOf<
  z.infer<typeof FraudReviewedEventSchema>
>()
expectTypeOf<WizardOutput<typeof fulfillmentFlow>>().toEqualTypeOf<
  { orderId: string; shipmentId: string | undefined } | undefined
>()

expectTypeOf<ProjectionScope<typeof customerOrderProjection>>().toMatchTypeOf<{
  role: 'customer'
  tenantId: string
  subjectId: string
}>()
expectTypeOf<ProjectionOutput<typeof customerOrderProjection>>().toEqualTypeOf<CustomerOrder>()

declare const run: Run<typeof fulfillmentFlow>
const customerPrincipal: CustomerPrincipal = {
  tenantId: 'tenant-acme',
  subjectId: 'customer-alice',
  role: 'customer',
}
const projected = run.project(customerOrderProjection, customerPrincipal)
expectTypeOf(projected).toEqualTypeOf<ProjectionOutput<typeof customerOrderProjection>>()

interface Viewer {
  readonly tenantId: string
  readonly role: 'customer' | 'operator'
}

const otherFlow = defineWizard(
  { name: 'other', context: boundary.trusted<{ orderId: string }>() },
  ({ step, steps }) => steps({ done: step({ run: () => undefined }) }),
)
const otherProjection = defineProjection(otherFlow, {
  scope: boundary.trusted<Viewer>(),
  select: ({ state }) => state.context.orderId,
})

// @ts-expect-error projection identity and scope are both checked at the run boundary
run.project(otherProjection, { tenantId: 'tenant-acme', role: 'customer' })

type CallbackType = PartnerCallback['type']
expectTypeOf<CallbackType>().toEqualTypeOf<
  | 'payment.authorization.succeeded'
  | 'payment.authorization.failed'
  | 'inventory.reservation.succeeded'
  | 'inventory.reservation.failed'
  | 'payment.capture.succeeded'
  | 'payment.capture.failed'
  | 'shipping.shipment.succeeded'
  | 'shipping.shipment.failed'
>()

// @ts-expect-error customer views do not carry operator workflow details
const leakedWorkflow: CustomerOrder = { ...customerOrder, workflow: {} }
void leakedWorkflow

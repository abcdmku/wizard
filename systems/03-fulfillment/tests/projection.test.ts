import type { CustomerPrincipal, OperatorPrincipal } from '@fulfillment/contracts'
import {
  customerOrderProjection,
  operatorOrderProjection,
  type PartnerViewer,
  partnerOrderProjection,
} from '@fulfillment/domain'
import { describe, expect, it } from 'vitest'
import { CustomerOrderSchema, OperatorOrderSchema } from '../apps/web/src/contracts'
import { freshDemoOrders, toCustomerOrder } from '../apps/web/src/demo-data'
import { flush, makeRun } from './support/fulfillment'

describe('fulfillment projections', () => {
  it('serializes a customer view without operator provider details', () => {
    const operatorOrder = freshDemoOrders().find((order) => order.status === 'shipping')
    if (operatorOrder === undefined) throw new Error('seed fixture has no shipping order')

    const customerOrder = toCustomerOrder(operatorOrder)
    expect(CustomerOrderSchema.parse(customerOrder)).toEqual(customerOrder)
    const wire = JSON.stringify(customerOrder)

    const providerRef = operatorOrder.partnerState.paymentAuthorization.id
    if (providerRef !== undefined) expect(wire).not.toContain(providerRef)
    expect(wire).not.toContain(operatorOrder.fraud.note ?? 'operator-only-fraud-note')
    expect(wire).not.toContain('paymentAuthorization')
    expect(wire).not.toContain('fraud')
    expect(wire).not.toContain('workflow')
    expect(wire).not.toContain('stack')
  })

  it('keeps provider references and fraud details in the operator view', () => {
    const operatorOrder = freshDemoOrders().find((order) => order.fraud.state === 'manual_review')
    if (operatorOrder === undefined) throw new Error('seed fixture has no fraud-hold order')

    const parsed = OperatorOrderSchema.parse(operatorOrder)

    expect(parsed.fraud.state).toBe('manual_review')
    expect(parsed.partnerState.paymentAuthorization.id).toBe('pay_auth_1047')
    expect(JSON.stringify(parsed)).toContain('Billing distance')
  })

  it('does not treat unknown customer fields as part of the wire contract', () => {
    const order = freshDemoOrders()[0]
    if (order === undefined) throw new Error('seed fixture is empty')
    const customer = toCustomerOrder(order)
    const parsed = CustomerOrderSchema.parse({ ...customer, fraudProviderSecret: 'nope' })
    expect('fraudProviderSecret' in parsed).toBe(false)
  })

  it('serializes a scoped production projection without internal context fields', async () => {
    const run = makeRun([])
    await run.start()
    await flush()
    const customerPrincipal: CustomerPrincipal = {
      tenantId: 'tenant-acme',
      subjectId: 'customer-alice',
      role: 'customer',
    }
    const operatorPrincipal: OperatorPrincipal = {
      tenantId: 'tenant-acme',
      subjectId: 'operator-olivia',
      role: 'operator',
    }
    const customer = run.project(customerOrderProjection, customerPrincipal)
    const operator = run.project(operatorOrderProjection, operatorPrincipal)
    const wire = JSON.stringify(customer)
    expect(wire).toContain(customer.id)
    expect(wire).not.toContain('customerId')
    expect(wire).not.toContain('paymentAuthorization')
    expect(wire).not.toContain('inventoryReservation')
    expect(wire).not.toContain('callbackUrl')
    expect(JSON.stringify(operator)).toContain('paymentAuthorization')
    run.dispose()
  })

  it('serializes a partner-safe view and rejects a scope from another tenant', async () => {
    const run = makeRun([])
    await run.start()
    await flush()
    const partnerViewer: PartnerViewer = {
      role: 'partner',
      tenantId: 'tenant-acme',
      partner: 'payment',
    }
    const partner = run.project(partnerOrderProjection, partnerViewer)
    const wire = JSON.stringify(partner)

    expect(wire).toContain('payment')
    expect(wire).not.toContain('customer-alice')
    expect(wire).not.toContain('shippingAddress')
    expect(wire).not.toContain('inventoryReservation')
    const foreignViewer: PartnerViewer = {
      role: 'partner',
      tenantId: 'tenant-globex',
      partner: 'payment',
    }
    expect(() => run.project(partnerOrderProjection, foreignViewer)).toThrow(
      'Projection scope mismatch',
    )
    run.dispose()
  })
})

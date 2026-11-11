import type { CreateOrder, CustomerOrder, CustomerPrincipal } from '@fulfillment/contracts'
import type { FulfillmentApplicationService } from './application-service'

const acme: CustomerPrincipal = {
  role: 'customer',
  tenantId: 'tenant-acme',
  subjectId: 'customer-alice',
}
const globex: CustomerPrincipal = {
  role: 'customer',
  tenantId: 'tenant-globex',
  subjectId: 'customer-gary',
}

const address = {
  recipient: 'Alice Example',
  line1: '42 Durable Way',
  city: 'Austin',
  region: 'TX',
  postalCode: '78701',
  country: 'US',
} as const

const demoOrders: readonly {
  readonly principal: CustomerPrincipal
  readonly key: string
  readonly input: CreateOrder
}[] = [
  {
    principal: acme,
    key: 'seed-acme-happy-v1',
    input: {
      currency: 'USD',
      lines: [{ sku: 'WIZARD-HAT', name: 'Wizard hat', quantity: 1, unitPriceMinor: 4_500 }],
      shippingAddress: address,
    },
  },
  {
    principal: acme,
    key: 'seed-acme-out-of-stock-v1',
    input: {
      currency: 'USD',
      lines: [{ sku: 'OOS', name: 'Rare spellbook', quantity: 1, unitPriceMinor: 8_000 }],
      shippingAddress: address,
    },
  },
  {
    principal: globex,
    key: 'seed-globex-private-v1',
    input: {
      currency: 'USD',
      lines: [{ sku: 'CRYSTAL', name: 'Crystal orb', quantity: 2, unitPriceMinor: 2_500 }],
      shippingAddress: { ...address, recipient: 'Gary Example' },
    },
  },
]

export async function seedDemo(service: FulfillmentApplicationService): Promise<CustomerOrder[]> {
  return Promise.all(
    demoOrders.map(async (seed) => {
      const result = await service.createOrder(seed.principal, seed.input, seed.key)
      return result.order
    }),
  )
}

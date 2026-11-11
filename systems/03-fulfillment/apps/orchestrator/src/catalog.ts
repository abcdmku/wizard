import type { FulfillmentContext } from '@fulfillment/domain'

export interface OrderRecord {
  readonly orderId: string
  readonly tenantId: string
  readonly customerId: string
  readonly status: string
  readonly active: boolean
  readonly createIdempotencyKey: string
  readonly requestDigest: string
  readonly initialContext: FulfillmentContext
  readonly createdAt: string
  readonly updatedAt: string
}

export interface NewOrderRecord extends OrderRecord {
  readonly active: true
}

export type CreateRecordResult =
  | { readonly kind: 'created'; readonly record: OrderRecord }
  | { readonly kind: 'replayed'; readonly record: OrderRecord }
  | { readonly kind: 'conflict' }

export interface OrderCatalog {
  create(record: NewOrderRecord): Promise<CreateRecordResult>
  get(orderId: string): Promise<OrderRecord | undefined>
  list(tenantId: string, customerId?: string): Promise<readonly OrderRecord[]>
  listActive(): Promise<readonly OrderRecord[]>
  updateRuntime(orderId: string, status: string, active: boolean, updatedAt: string): Promise<void>
  recordCallback(input: {
    readonly eventId: string
    readonly orderId: string
    readonly partner: string
    readonly digest: string
    readonly outcome: string
  }): Promise<void>
}

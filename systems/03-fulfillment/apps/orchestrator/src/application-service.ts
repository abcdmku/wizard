import { randomUUID } from 'node:crypto'
import type {
  CreateOrder,
  CustomerOrder,
  CustomerPrincipal,
  FraudDecision,
  OperatorOrder,
  OperatorPrincipal,
  PartnerCallback,
  PartnerIdentity,
  PartnerOrder,
} from '@fulfillment/contracts'
import {
  customerOrderProjection,
  FulfillmentContextSchema,
  operatorOrderProjection,
  type PartnerViewer,
  partnerOrderProjection,
} from '@fulfillment/domain'
import {
  createRecord,
  digestObject,
  ensureAppliedCommand,
  ensureDurableSuccess,
  notFound,
  orderTotal,
  partnerMatches,
} from './application-helpers'
import type { OrderCatalog } from './catalog'
import { FulfillmentServiceError } from './errors'
import type { DurableOrderRegistry } from './registry'

interface ApplicationServiceOptions {
  readonly catalog: OrderCatalog
  readonly registry: DurableOrderRegistry
  readonly callbackUrl: string
  readonly now?: () => string
  readonly newId?: () => string
}

export interface CreateOrderResult {
  readonly order: CustomerOrder
  readonly replayed: boolean
}

export interface CallbackResult {
  readonly accepted: true
  readonly duplicate: boolean
  readonly delivery: 'delivered' | 'buffered' | 'dropped'
  readonly order: PartnerOrder
}

export class FulfillmentApplicationService {
  private readonly now: () => string
  private readonly newId: () => string

  constructor(private readonly options: ApplicationServiceOptions) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.newId = options.newId ?? randomUUID
  }

  async createOrder(
    principal: CustomerPrincipal,
    input: CreateOrder,
    idempotencyKey: string,
  ): Promise<CreateOrderResult> {
    const totalMinor = orderTotal(input)
    const now = this.now()
    const orderId = this.newId()
    const context = FulfillmentContextSchema.parse({
      orderId,
      tenantId: principal.tenantId,
      customerId: principal.subjectId,
      currency: input.currency,
      totalMinor,
      lines: input.lines,
      shippingAddress: input.shippingAddress,
      callbackUrl: this.options.callbackUrl,
      createdAt: now,
      updatedAt: now,
      paymentAuthorization: { state: 'pending' },
      inventoryReservation: { state: 'pending' },
      paymentCapture: { state: 'idle' },
      fraud: { state: 'pending' },
      shipment: { state: 'idle' },
    })
    const created = await this.options.catalog.create(
      createRecord(context, idempotencyKey, digestObject(input)),
    )
    if (created.kind === 'conflict') {
      throw new FulfillmentServiceError(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency-Key was already used for a different order request',
        409,
      )
    }
    const host = await this.options.registry.open(created.record)
    const started = await host.dispatch(
      { type: 'start' },
      { commandId: `order:${created.record.orderId}:start` },
    )
    ensureAppliedCommand(started)
    return {
      order: host.run.project(customerOrderProjection, principal),
      replayed: created.kind === 'replayed',
    }
  }

  async getCustomerOrder(principal: CustomerPrincipal, orderId: string): Promise<CustomerOrder> {
    const record = await this.customerRecord(principal, orderId)
    const host = await this.options.registry.open(record)
    return host.run.project(customerOrderProjection, principal)
  }

  async listCustomerOrders(principal: CustomerPrincipal): Promise<readonly CustomerOrder[]> {
    const records = await this.options.catalog.list(principal.tenantId, principal.subjectId)
    return Promise.all(
      records.map(async (record) => {
        const host = await this.options.registry.open(record)
        return host.run.project(customerOrderProjection, principal)
      }),
    )
  }

  async cancelOrder(
    principal: CustomerPrincipal,
    orderId: string,
    reason: string,
    idempotencyKey: string,
  ): Promise<CustomerOrder> {
    const record = await this.customerRecord(principal, orderId)
    const host = await this.options.registry.open(record)
    const payload = {
      orderId,
      reason,
      cancelledBy: principal.subjectId,
      cancelledAt: this.now(),
    }
    const commandId = `customer-cancel:${idempotencyKey}`
    const result = await host.dispatch(
      {
        type: 'send',
        event: 'order.cancelled',
        payload,
        eventId: commandId,
        correlationId: orderId,
      },
      {
        commandId,
        digest: digestObject({ orderId, reason, cancelledBy: principal.subjectId }),
      },
    )
    ensureAppliedCommand(result)
    return host.run.project(customerOrderProjection, principal)
  }

  async getOperatorOrder(principal: OperatorPrincipal, orderId: string): Promise<OperatorOrder> {
    const record = await this.operatorRecord(principal, orderId)
    const host = await this.options.registry.open(record)
    return host.run.project(operatorOrderProjection, principal)
  }

  async listOperatorOrders(principal: OperatorPrincipal): Promise<readonly OperatorOrder[]> {
    const records = await this.options.catalog.list(principal.tenantId)
    return Promise.all(
      records.map(async (record) => {
        const host = await this.options.registry.open(record)
        return host.run.project(operatorOrderProjection, principal)
      }),
    )
  }

  async reviewFraud(
    principal: OperatorPrincipal,
    orderId: string,
    review: FraudDecision,
    idempotencyKey: string,
  ): Promise<OperatorOrder> {
    const record = await this.operatorRecord(principal, orderId)
    const host = await this.options.registry.open(record)
    const payload = {
      orderId,
      decision: review.decision,
      reviewerId: principal.subjectId,
      ...(review.note === undefined ? {} : { note: review.note }),
      decidedAt: this.now(),
    }
    const commandId = `fraud-review:${idempotencyKey}`
    const waiting = host.run.getState().steps.waitFraudReview.status === 'active'
    const result = await host.dispatch(
      {
        type: 'send',
        event: 'fraud.reviewed',
        payload,
        eventId: commandId,
        correlationId: orderId,
      },
      {
        commandId,
        expectedVersion: host.version,
        digest: digestObject({
          orderId,
          decision: review.decision,
          reviewerId: principal.subjectId,
          ...(review.note === undefined ? {} : { note: review.note }),
        }),
      },
    )
    ensureAppliedCommand(result)
    if (result.ok && result.status === 'applied' && !waiting) {
      throw new FulfillmentServiceError(
        'INVALID_OPERATION',
        'Fraud review has already been decided',
        409,
      )
    }
    return host.run.project(operatorOrderProjection, principal)
  }

  async receivePartnerCallback(
    partner: PartnerIdentity,
    callback: PartnerCallback,
    rawDigest: string,
  ): Promise<CallbackResult> {
    if (!partnerMatches(partner, callback.type)) {
      throw new FulfillmentServiceError('FORBIDDEN', 'Partner cannot emit this callback type', 403)
    }
    const record = await this.options.catalog.get(callback.orderId)
    if (record === undefined || record.tenantId !== callback.tenantId) notFound()
    const host = await this.options.registry.open(record)
    const sent = await host.send(callback.type, callback, {
      eventId: callback.eventId,
      correlationId: callback.orderId,
    })
    if (!sent.ok && !('reason' in sent)) ensureDurableSuccess(sent)
    const duplicate = sent.ok && sent.duplicate === true
    const delivery = sent.ok ? (sent.buffered ? 'buffered' : 'delivered') : 'dropped'
    await this.options.catalog.recordCallback({
      eventId: callback.eventId,
      orderId: callback.orderId,
      partner,
      digest: rawDigest,
      outcome: `${duplicate ? 'replayed' : 'applied'}:${delivery}`,
    })
    const viewer: PartnerViewer = {
      role: 'partner',
      tenantId: callback.tenantId,
      partner,
    }
    const order = host.run.project(partnerOrderProjection, viewer)
    return { accepted: true, duplicate, delivery, order }
  }

  async recoverActiveOrders(): Promise<void> {
    await this.options.registry.recover()
  }

  private async customerRecord(principal: CustomerPrincipal, orderId: string) {
    const record = await this.options.catalog.get(orderId)
    if (
      record === undefined ||
      record.tenantId !== principal.tenantId ||
      record.customerId !== principal.subjectId
    ) {
      notFound()
    }
    return record
  }

  private async operatorRecord(principal: OperatorPrincipal, orderId: string) {
    const record = await this.options.catalog.get(orderId)
    if (record === undefined || record.tenantId !== principal.tenantId) notFound()
    return record
  }
}

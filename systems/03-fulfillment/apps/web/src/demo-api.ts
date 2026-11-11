import type { FulfillmentApi } from './api-contract'
import { ApiError } from './api-contract'
import {
  type CancelOrder,
  CancelOrderSchema,
  type CreateOrder,
  CreateOrderSchema,
  type CustomerOrder,
  type FraudDecision,
  FraudDecisionSchema,
  isCustomerCancellable,
  type OperatorOrder,
  OperatorOrderListResponseSchema,
  OperatorOrderResponseSchema,
} from './contracts'
import { freshDemoOrders, toCustomerOrder } from './demo-data'

export class DemoFulfillmentApi implements FulfillmentApi {
  readonly isDemo = true
  #orders = freshDemoOrders()

  async listCustomerOrders(): Promise<CustomerOrder[]> {
    await pause(360)
    return this.#orders.map(toCustomerOrder)
  }

  async getCustomerOrder(orderId: string): Promise<CustomerOrder> {
    await pause(220)
    return toCustomerOrder(this.#find(orderId))
  }

  async createOrder(request: CreateOrder): Promise<CustomerOrder> {
    const input = CreateOrderSchema.parse(request)
    await pause(700)
    const now = new Date().toISOString()
    const order = OperatorOrderResponseSchema.parse({
      order: {
        id: crypto.randomUUID(),
        status: 'processing',
        currency: input.currency,
        totalMinor: input.lines.reduce(
          (total, line) => total + line.quantity * line.unitPriceMinor,
          0,
        ),
        lines: input.lines,
        createdAt: now,
        updatedAt: now,
        tenantId: 'tenant-demo',
        customerId: 'demo-customer',
        shippingAddress: input.shippingAddress,
        partnerState: {
          paymentAuthorization: { state: 'requested' },
          inventoryReservation: { state: 'requested' },
          paymentCapture: { state: 'not_started' },
          shipment: { state: 'not_started' },
        },
        fraud: { state: 'not_started' },
        workflow: {
          status: 'running',
          current: 'parallel-checks',
          seq: 2,
          bufferedCallbacks: 0,
          deadLetter: false,
          steps: [
            { id: 'authorize-payment', status: 'active', phase: 'running', attempt: 1 },
            { id: 'reserve-inventory', status: 'active', phase: 'running', attempt: 1 },
          ],
        },
      },
    }).order
    this.#orders = [order, ...this.#orders]
    return toCustomerOrder(order)
  }

  async cancelOrder(orderId: string, request: CancelOrder): Promise<CustomerOrder> {
    CancelOrderSchema.parse(request)
    await pause(520)
    const current = this.#find(orderId)
    if (!isCustomerCancellable(current.status)) {
      throw new ApiError('This order can no longer be cancelled.', 409, 'ORDER_NOT_CANCELLABLE')
    }
    const order = OperatorOrderResponseSchema.parse({
      order: {
        ...current,
        updatedAt: new Date().toISOString(),
        status: 'cancelling',
        partnerState: {
          ...current.partnerState,
          paymentAuthorization: {
            ...current.partnerState.paymentAuthorization,
            state: 'reversing',
          },
          inventoryReservation: {
            ...current.partnerState.inventoryReservation,
            state: 'releasing',
          },
          shipment: { ...current.partnerState.shipment, state: 'cancelled' },
        },
        fraud: { ...current.fraud, state: 'cancelled' },
        workflow: {
          ...current.workflow,
          status: 'compensating',
          current: 'reverse-completed-work',
          seq: current.workflow.seq + 1,
          steps: [
            ...current.workflow.steps,
            { id: 'reverse-payment', status: 'active', phase: 'compensating', attempt: 1 },
            { id: 'release-inventory', status: 'active', phase: 'compensating', attempt: 1 },
          ],
        },
      },
    }).order
    this.#replace(order)
    return toCustomerOrder(order)
  }

  async listOperatorOrders(): Promise<OperatorOrder[]> {
    await pause(420)
    return OperatorOrderListResponseSchema.parse({ orders: this.#orders }).orders
  }

  async getOperatorOrder(orderId: string): Promise<OperatorOrder> {
    await pause(220)
    return OperatorOrderResponseSchema.parse({ order: this.#find(orderId) }).order
  }

  async decideFraud(orderId: string, request: FraudDecision): Promise<OperatorOrder> {
    const input = FraudDecisionSchema.parse(request)
    await pause(620)
    const current = this.#find(orderId)
    if (current.status !== 'fraud_review') {
      throw new ApiError('This order is no longer waiting for review.', 409, 'REVIEW_CLOSED')
    }
    const approved = input.decision === 'approve'
    const order = OperatorOrderResponseSchema.parse({
      order: {
        ...current,
        status: approved ? 'shipping' : 'cancelling',
        updatedAt: new Date().toISOString(),
        partnerState: approved
          ? { ...current.partnerState, shipment: { state: 'waiting', requestId: 'ship_req_demo' } }
          : {
              ...current.partnerState,
              paymentAuthorization: {
                ...current.partnerState.paymentAuthorization,
                state: 'reversing',
              },
              inventoryReservation: {
                ...current.partnerState.inventoryReservation,
                state: 'releasing',
              },
            },
        fraud: {
          ...current.fraud,
          state: approved ? 'approved' : 'rejected',
          reviewerId: 'operator-olivia',
          note: input.note,
        },
        workflow: {
          ...current.workflow,
          status: approved ? 'running' : 'compensating',
          current: approved ? 'create-shipment' : 'reverse-completed-work',
          seq: current.workflow.seq + 1,
          steps: [
            ...current.workflow.steps.map((step) =>
              step.id === 'fraud-review' ? { ...step, status: 'done', phase: 'complete' } : step,
            ),
            ...(approved
              ? [{ id: 'create-shipment', status: 'active', phase: 'waiting', attempt: 1 }]
              : [
                  { id: 'reverse-payment', status: 'active', phase: 'compensating', attempt: 1 },
                  { id: 'release-inventory', status: 'active', phase: 'compensating', attempt: 1 },
                ]),
          ],
        },
      },
    }).order
    this.#replace(order)
    return OperatorOrderResponseSchema.parse({ order }).order
  }

  #find(orderId: string): OperatorOrder {
    const order = this.#orders.find((candidate) => candidate.id === orderId)
    if (order === undefined) throw new ApiError('Order not found.', 404, 'ORDER_NOT_FOUND')
    return order
  }

  #replace(order: OperatorOrder): void {
    this.#orders = this.#orders.map((candidate) => (candidate.id === order.id ? order : candidate))
  }
}

const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

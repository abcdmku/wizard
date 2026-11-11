import type { z } from 'zod'
import type { FulfillmentApi } from './api-contract'
import { ApiError } from './api-contract'
import {
  type CancelOrder,
  CancelOrderSchema,
  type CreateOrder,
  CreateOrderSchema,
  type CustomerOrder,
  CustomerOrderListResponseSchema,
  CustomerOrderResponseSchema,
  ErrorResponseSchema,
  type FraudDecision,
  FraudDecisionSchema,
  type OperatorOrder,
  OperatorOrderListResponseSchema,
  OperatorOrderResponseSchema,
} from './contracts'

export class HttpFulfillmentApi implements FulfillmentApi {
  readonly isDemo = false
  readonly #baseUrl: string

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, '')
  }

  async listCustomerOrders(): Promise<CustomerOrder[]> {
    const response = await this.#request('/customer/orders', CustomerOrderListResponseSchema, {
      headers: customerHeaders(),
    })
    return response.orders
  }

  async getCustomerOrder(orderId: string): Promise<CustomerOrder> {
    const response = await this.#request(
      `/customer/orders/${encodeURIComponent(orderId)}`,
      CustomerOrderResponseSchema,
      { headers: customerHeaders() },
    )
    return response.order
  }

  async createOrder(request: CreateOrder): Promise<CustomerOrder> {
    const input = CreateOrderSchema.parse(request)
    const response = await this.#request('/customer/orders', CustomerOrderResponseSchema, {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { ...customerHeaders(), ...idempotencyHeaders() },
    })
    return response.order
  }

  async cancelOrder(orderId: string, request: CancelOrder): Promise<CustomerOrder> {
    const input = CancelOrderSchema.parse(request)
    const response = await this.#request(
      `/customer/orders/${encodeURIComponent(orderId)}/cancel`,
      CustomerOrderResponseSchema,
      {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { ...customerHeaders(), ...idempotencyHeaders() },
      },
    )
    return response.order
  }

  async listOperatorOrders(): Promise<OperatorOrder[]> {
    const response = await this.#request('/operator/orders', OperatorOrderListResponseSchema, {
      headers: operatorHeaders(),
    })
    return response.orders
  }

  async getOperatorOrder(orderId: string): Promise<OperatorOrder> {
    const response = await this.#request(
      `/operator/orders/${encodeURIComponent(orderId)}`,
      OperatorOrderResponseSchema,
      { headers: operatorHeaders() },
    )
    return response.order
  }

  async decideFraud(orderId: string, request: FraudDecision): Promise<OperatorOrder> {
    const input = FraudDecisionSchema.parse(request)
    const response = await this.#request(
      `/operator/orders/${encodeURIComponent(orderId)}/fraud/${input.decision}`,
      OperatorOrderResponseSchema,
      {
        method: 'POST',
        body: JSON.stringify({ note: input.note }),
        headers: { ...operatorHeaders(), ...idempotencyHeaders() },
      },
    )
    return response.order
  }

  async #request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${this.#baseUrl}${path}`, {
        ...init,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...init?.headers,
        },
      })
    } catch (error) {
      throw new ApiError(
        error instanceof Error ? error.message : 'The fulfillment API could not be reached.',
        0,
      )
    }
    const body: unknown = await response.json().catch(() => undefined)
    if (!response.ok) {
      const parsed = ErrorResponseSchema.safeParse(body)
      throw new ApiError(
        parsed.success ? parsed.data.error.message : `Request failed (${response.status}).`,
        response.status,
        parsed.success ? parsed.data.error.code : undefined,
      )
    }
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      throw new ApiError(
        'The API returned data this app does not understand.',
        502,
        'INVALID_RESPONSE',
      )
    }
    return parsed.data
  }
}

function idempotencyHeaders(): Record<string, string> {
  return { 'Idempotency-Key': crypto.randomUUID() }
}

function customerHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${import.meta.env.VITE_CUSTOMER_TOKEN ?? 'customer-acme'}` }
}

function operatorHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${import.meta.env.VITE_OPERATOR_TOKEN ?? 'operator-acme'}` }
}

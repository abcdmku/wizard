import type {
  CancelOrder,
  CreateOrder,
  CustomerOrder,
  FraudDecision,
  OperatorOrder,
} from './contracts'

export interface FulfillmentApi {
  readonly isDemo: boolean
  listCustomerOrders(): Promise<CustomerOrder[]>
  getCustomerOrder(orderId: string): Promise<CustomerOrder>
  createOrder(request: CreateOrder): Promise<CustomerOrder>
  cancelOrder(orderId: string, request: CancelOrder): Promise<CustomerOrder>
  listOperatorOrders(): Promise<OperatorOrder[]>
  getOperatorOrder(orderId: string): Promise<OperatorOrder>
  decideFraud(orderId: string, request: FraudDecision): Promise<OperatorOrder>
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export type ServiceErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'IDEMPOTENCY_CONFLICT'
  | 'WORKFLOW_BUSY'
  | 'WORKFLOW_REJECTED'
  | 'INVALID_OPERATION'

export class FulfillmentServiceError extends Error {
  constructor(
    readonly code: ServiceErrorCode,
    message: string,
    readonly statusCode: number,
    readonly retryAt?: number,
  ) {
    super(message)
    this.name = 'FulfillmentServiceError'
  }
}

import type { FulfillmentFailure } from './model'

export class FulfillmentWorkflowError extends Error {
  readonly data: FulfillmentFailure

  constructor(data: FulfillmentFailure) {
    super(data.message)
    this.name = 'FulfillmentWorkflowError'
    this.data = data
  }
}

export function mappedFailure(error: unknown, attempt: number): FulfillmentFailure {
  if (error instanceof FulfillmentWorkflowError) return error.data
  return {
    code: 'PARTNER_REQUEST_FAILED',
    message: error instanceof Error ? error.message : 'Partner request failed',
    retryable: true,
    operation: `attempt-${attempt}`,
  }
}

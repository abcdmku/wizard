import { FulfillmentWorkflowError } from './failures'
import type { FulfillmentFailure } from './model'

export const workflowFailure = (
  code: string,
  message: string,
  operation: string,
  retryable = false,
): FulfillmentFailure => ({ code, message, operation, retryable })

export const requiredState = (value: string | undefined, name: string): string => {
  if (value === undefined) {
    throw new FulfillmentWorkflowError(
      workflowFailure('STATE_INCOMPLETE', `${name} is missing`, name),
    )
  }
  return value
}

export const failFromContext = (lastFailure: FulfillmentFailure | undefined): never => {
  throw new FulfillmentWorkflowError(
    lastFailure ??
      workflowFailure('FULFILLMENT_FAILED', 'The order could not continue', 'workflow'),
  )
}

import { createHash } from 'node:crypto'
import type { CreateOrder, PartnerCallback, PartnerIdentity } from '@fulfillment/contracts'
import type { FulfillmentContext } from '@fulfillment/domain'
import type { DurableCommandResult, DurableEventResult } from '@openwizard/durable'
import type { NewOrderRecord } from './catalog'
import { FulfillmentServiceError } from './errors'

type DurableResult = DurableCommandResult | DurableEventResult

export function createRecord(
  context: FulfillmentContext,
  idempotencyKey: string,
  requestDigest: string,
): NewOrderRecord {
  return {
    orderId: context.orderId,
    tenantId: context.tenantId,
    customerId: context.customerId,
    status: 'processing',
    active: true,
    createIdempotencyKey: idempotencyKey,
    requestDigest,
    initialContext: context,
    createdAt: context.createdAt,
    updatedAt: context.updatedAt,
  }
}

export function orderTotal(input: CreateOrder): number {
  const value = input.lines.reduce((sum, line) => sum + line.quantity * line.unitPriceMinor, 0)
  if (!Number.isSafeInteger(value) || value <= 0 || value > 100_000_000) {
    throw new FulfillmentServiceError('INVALID_OPERATION', 'Order total is out of range', 400)
  }
  return value
}

export function digestObject(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function ensureDurableSuccess<T extends DurableResult>(
  result: T,
): asserts result is Extract<T, { readonly ok: true }> {
  if (result.ok) return
  const conflict = result.code === 'DEDUPLICATE_CONFLICT'
  const stale = result.code === 'CAS_CONFLICT'
  throw new FulfillmentServiceError(
    conflict ? 'IDEMPOTENCY_CONFLICT' : 'WORKFLOW_BUSY',
    conflict
      ? 'Idempotency key was reused with different data'
      : stale
        ? 'Workflow changed before the command was applied'
        : 'Workflow is unavailable',
    conflict || stale ? 409 : 503,
  )
}

export function ensureAppliedCommand(result: DurableCommandResult): void {
  ensureDurableSuccess(result)
  if (!result.result.ok) {
    throw new FulfillmentServiceError(
      'INVALID_OPERATION',
      `Workflow rejected the command: ${result.result.code}`,
      409,
    )
  }
}

export function partnerMatches(partner: PartnerIdentity, type: PartnerCallback['type']): boolean {
  return type.startsWith(`${partner}.`)
}

export function notFound(): never {
  throw new FulfillmentServiceError('NOT_FOUND', 'Order not found', 404)
}

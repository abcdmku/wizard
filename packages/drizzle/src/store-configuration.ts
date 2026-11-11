import type { LeaseOptions, RetentionSweepOptions } from '@openwizard/durable/store'
import { DurableStoreError } from '@openwizard/durable/store'
import type { Configuration, DrizzleDurableStoreOptions } from './store-types'

const DEFAULT_LEASE_TTL_MS = 30_000
const DEFAULT_TIMER_CLAIM_TTL_MS = 30_000
const DEFAULT_DEDUPE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_TIMER_RETENTION_MS = 5 * 60 * 1000

export function makeConfiguration(options: DrizzleDurableStoreOptions): Configuration {
  const retention = options.retention ?? {
    completedDedupeMs: DEFAULT_DEDUPE_RETENTION_MS,
    timerClaimMs: DEFAULT_TIMER_RETENTION_MS,
  }
  return {
    now: options.now ?? Date.now,
    leaseTtlMs: requirePositiveFinite(options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS, 'leaseTtlMs'),
    timerClaimTtlMs: requirePositiveFinite(
      options.timerClaimTtlMs ?? DEFAULT_TIMER_CLAIM_TTL_MS,
      'timerClaimTtlMs',
    ),
    completedDedupeMs: requireNonNegativeFinite(
      retention.completedDedupeMs,
      'retention.completedDedupeMs',
    ),
    timerClaimMs: requireNonNegativeFinite(retention.timerClaimMs, 'retention.timerClaimMs'),
  }
}

export function readNow(configuration: Configuration): number {
  const now = configuration.now()
  if (!Number.isFinite(now)) {
    throw new DurableStoreError('INVALID_ARGUMENT', 'the store clock must return a finite number')
  }
  return now
}

export function readTtl(options: LeaseOptions | undefined, fallback: number): number {
  return requirePositiveFinite(options?.ttlMs ?? fallback, 'ttlMs')
}

export function readLimit(options: RetentionSweepOptions | undefined): number {
  const limit = options?.limit ?? Number.MAX_SAFE_INTEGER
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new DurableStoreError(
      'INVALID_ARGUMENT',
      'retention limit must be a non-negative safe integer',
    )
  }
  return limit
}

function requirePositiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new DurableStoreError(
      'INVALID_ARGUMENT',
      `${name} must be a finite number greater than 0`,
    )
  }
  return value
}

function requireNonNegativeFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new DurableStoreError('INVALID_ARGUMENT', `${name} must be a finite number at least 0`)
  }
  return value
}

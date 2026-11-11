import {
  DurableStoreError,
  type LeaseOptions,
  type RetentionPolicy,
  type RetentionSweepOptions,
} from '@openwizard/durable/store'

const DEFAULT_LEASE_TTL_MS = 30_000
const DEFAULT_TIMER_CLAIM_TTL_MS = 30_000
const DEFAULT_DEDUPE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_TIMER_RETENTION_MS = 5 * 60 * 1000

/** The options every store accepts. Each adapter publishes its own documented copy. */
export interface StoreOptions {
  readonly now?: () => number
  readonly leaseTtlMs?: number
  readonly timerClaimTtlMs?: number
  readonly retention?: RetentionPolicy
}

/** Store options with defaults applied and every number checked. */
export interface StoreConfiguration {
  now: () => number
  leaseTtlMs: number
  timerClaimTtlMs: number
  completedDedupeMs: number
  timerClaimMs: number
}

/** Apply the defaults: 30 s leases and timer claims, 7 days of dedupe, 5 minutes of timer claims. */
export function makeStoreConfiguration(options: StoreOptions): StoreConfiguration {
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

/** Read the store clock once for an operation. */
export function readNow(configuration: Pick<StoreConfiguration, 'now'>): number {
  const now = configuration.now()
  if (!Number.isFinite(now)) {
    throw new DurableStoreError('INVALID_ARGUMENT', 'the store clock must return a finite number')
  }
  return now
}

/** The lease TTL a caller asked for, or the store default. */
export function readTtl(options: LeaseOptions | undefined, fallback: number): number {
  return requirePositiveFinite(options?.ttlMs ?? fallback, 'ttlMs')
}

/** The most rows one retention pass may remove. No limit reads as `Number.MAX_SAFE_INTEGER`. */
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

import {
  type DurableRecord,
  DurableStoreError,
  type Lease,
  type Version,
} from '@openwizard/durable/store'
import type { MemoryDurableStoreOptions } from './memory-store'

const DEFAULT_LEASE_TTL_MS = 30_000
const DEFAULT_TIMER_CLAIM_TTL_MS = 30_000
const DEFAULT_DEDUPE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_TIMER_RETENTION_MS = 5 * 60 * 1000

export interface InternalLease {
  key: string
  ownerId: string
  fence: string
  expiresAt: number
}

/** A claim not completed yet; `applied` once a committed snapshot may contain its effects. */
export interface OpenDedupe {
  status: 'pending' | 'applied'
  digest: string
  claimId: string
  ownerFence: string
  claimedAt: number
  request?: unknown
}

export interface CompletedDedupe {
  status: 'completed'
  digest: string
  result: unknown
  completedAt: number
}

export type InternalDedupe = OpenDedupe | CompletedDedupe

export interface TimerClaim {
  timerId: string
  dueAt: number
  expected: Version
  claimId: string
  ownerFence: string
  claimedUntil: number
}

export interface Row {
  key: string
  fenceCounter: number
  claimCounter: number
  lease: InternalLease | undefined
  record?: DurableRecord
  dedupe: Map<string, InternalDedupe>
  timers: Map<string, TimerClaim>
}

export interface Configuration {
  now: () => number
  leaseTtlMs: number
  timerClaimTtlMs: number
  completedDedupeMs: number
  timerClaimMs: number
}

export interface MemoryStoreState {
  readonly configuration: Configuration
  readonly rows: Map<string, Row>
}

export function createMemoryStoreState(options: MemoryDurableStoreOptions): MemoryStoreState {
  const retention = options.retention ?? {
    completedDedupeMs: DEFAULT_DEDUPE_RETENTION_MS,
    timerClaimMs: DEFAULT_TIMER_RETENTION_MS,
  }
  return {
    configuration: {
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
    },
    rows: new Map(),
  }
}

export function getOrCreateRow(rows: Map<string, Row>, key: string): Row {
  const existing = rows.get(key)
  if (existing !== undefined) return existing
  const row: Row = {
    key,
    fenceCounter: 0,
    claimCounter: 0,
    lease: undefined,
    dedupe: new Map(),
    timers: new Map(),
  }
  rows.set(key, row)
  return row
}

export function nextFence(row: Row): string {
  if (row.fenceCounter >= Number.MAX_SAFE_INTEGER) {
    throw new DurableStoreError('FENCE_EXHAUSTED', `fence counter exhausted for '${row.key}'`)
  }
  row.fenceCounter++
  return String(row.fenceCounter)
}

export function nextClaimId(row: Row, kind: 'dedupe' | 'timer'): string {
  if (row.claimCounter >= Number.MAX_SAFE_INTEGER) {
    throw new DurableStoreError('FENCE_EXHAUSTED', `claim counter exhausted for '${row.key}'`)
  }
  row.claimCounter++
  return `${kind}:${row.claimCounter}`
}

export function readNow(configuration: Configuration): number {
  const now = configuration.now()
  if (!Number.isFinite(now)) {
    throw new DurableStoreError('INVALID_ARGUMENT', 'the store clock must return a finite number')
  }
  return now
}

export function isCurrentLease(row: Row, lease: Lease, now: number): boolean {
  const current = row.lease
  return (
    current !== undefined &&
    current.ownerId === lease.ownerId &&
    current.fence === lease.fence &&
    current.expiresAt > now
  )
}

export function readRequest(request: unknown, existing: InternalDedupe | undefined): unknown {
  if (request !== undefined) return cloneValue(request, 'dedupe request')
  if (existing?.status === 'pending' && existing.request !== undefined) {
    return cloneValue(existing.request, 'dedupe request')
  }
  return undefined
}

export function copyOptionalValue(value: unknown, name: string): unknown {
  return value === undefined ? undefined : cloneValue(value, name)
}

export function cloneValue<Value>(value: Value, name: string): Value {
  let raw: string | undefined
  try {
    raw = JSON.stringify(value)
  } catch {
    throw new DurableStoreError('NOT_SERIALIZABLE', `${name} is not JSON-serializable`)
  }
  if (raw === undefined) {
    throw new DurableStoreError('NOT_SERIALIZABLE', `${name} is not JSON-serializable`)
  }
  return JSON.parse(raw)
}

export function copyVersion(version: Version): Version {
  return { epoch: version.epoch, seq: version.seq }
}

export function copyNullableVersion(version: Version | null): Version | null {
  return version === null ? null : copyVersion(version)
}

export function copyLease(lease: InternalLease): Lease {
  return {
    key: lease.key,
    ownerId: lease.ownerId,
    fence: lease.fence,
    expiresAt: lease.expiresAt,
  }
}

export function copyRecord(record: DurableRecord, name = 'stored record'): DurableRecord {
  return {
    value: cloneValue(record.value, name),
    version: copyVersion(record.version),
  }
}

export function compareVersion(left: Version, right: Version): number {
  return left.epoch - right.epoch || left.seq - right.seq
}

export function sameVersion(left: Version | null, right: Version | null): boolean {
  return (
    (left === null && right === null) ||
    (left !== null && right !== null && left.epoch === right.epoch && left.seq === right.seq)
  )
}

function requirePositiveFinite(value: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new DurableStoreError(
      'INVALID_ARGUMENT',
      `${name} must be a finite number greater than 0`,
    )
  }
  return value
}

function requireNonNegativeFinite(value: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new DurableStoreError('INVALID_ARGUMENT', `${name} must be a finite number at least 0`)
  }
  return value
}

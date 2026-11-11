import type {
  DedupeApplication,
  DedupeCompletion,
  DurableRecord,
  Lease,
  TimerCompletion,
  Version,
} from '@openwizard/durable/store'
import { DurableStoreError } from '@openwizard/durable/store'
import type { DedupeRow, RunRow, TimerRow } from './store-types'

export function nextCounter(current: number, key: string, name: string): number {
  if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) {
    throw new DurableStoreError('FENCE_EXHAUSTED', `${name} counter exhausted for '${key}'`)
  }
  return current + 1
}

export function hasLiveLease(
  row: RunRow,
  now: number,
): row is RunRow & { ownerId: string; fence: string; leaseExpiresAt: number } {
  return (
    row.ownerId !== null &&
    row.fence !== null &&
    row.leaseExpiresAt !== null &&
    row.leaseExpiresAt > now
  )
}

export function isCurrentLease(row: RunRow, lease: Lease, now: number): boolean {
  return (
    row.ownerId === lease.ownerId &&
    row.fence === lease.fence &&
    row.leaseExpiresAt !== null &&
    row.leaseExpiresAt > now
  )
}

export function versionFromRow(row: RunRow): Version | null {
  if (row.snapshotEpoch === null || row.snapshotSeq === null || row.snapshot === null) return null
  return { epoch: row.snapshotEpoch, seq: row.snapshotSeq }
}

export function recordFromRow(row: RunRow): DurableRecord | null {
  const version = versionFromRow(row)
  if (version === null || row.snapshot === null) return null
  return { value: parseJson(row.snapshot, 'stored snapshot'), version }
}

export function serializeJson(value: unknown, name: string): string {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new DurableStoreError('NOT_SERIALIZABLE', `${name} is not JSON-serializable`)
  }
  if (serialized === undefined) {
    throw new DurableStoreError('NOT_SERIALIZABLE', `${name} is not JSON-serializable`)
  }
  return serialized
}

export function parseJson(value: string | null, name: string): unknown {
  if (value === null) {
    throw new DurableStoreError('INVALID_ARGUMENT', `${name} is missing from durable storage`)
  }
  try {
    return JSON.parse(value)
  } catch {
    throw new DurableStoreError('INVALID_ARGUMENT', `${name} is not valid JSON`)
  }
}

export function parseOptionalJson(value: string | null, name: string): unknown {
  return value === null ? undefined : parseJson(value, name)
}

/** A pending or applied claim this fence still holds. */
export function isOpenClaim(
  row: DedupeRow | null,
  claim: DedupeApplication,
  fence: string,
): boolean {
  return (
    row !== null &&
    row.status !== 'completed' &&
    row.claimId === claim.claimId &&
    row.ownerFence === fence
  )
}

export function isCompletableDedupe(
  row: DedupeRow | null,
  completion: DedupeCompletion,
  fence: string,
): boolean {
  return isOpenClaim(row, completion, fence) && row?.digest === completion.digest
}

export function isCompletableTimer(
  row: TimerRow | null,
  completion: TimerCompletion,
  fence: string,
): boolean {
  return (
    row !== null &&
    row.dueAt === completion.dueAt &&
    row.expectedEpoch === completion.expected.epoch &&
    row.expectedSeq === completion.expected.seq &&
    row.claimId === completion.claimId &&
    row.ownerFence === fence
  )
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

import type { DurableRecord, Lease, Version } from '@openwizard/durable/store'
import { DurableStoreError } from '@openwizard/durable/store'
import { isCurrentLease as holdsLease, type TimerClaimView } from '@openwizard/store-kit'
import type { RunRow, TimerRow } from './store-types'

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
  return holdsLease(
    { ownerId: row.ownerId, fence: row.fence, expiresAt: row.leaseExpiresAt },
    lease,
    now,
  )
}

/** The timer claim a row stores, in the shape the shared claim predicates read. */
export function timerClaimView(row: TimerRow | null): TimerClaimView | null {
  if (row === null) return null
  return {
    dueAt: row.dueAt,
    expected: { epoch: row.expectedEpoch, seq: row.expectedSeq },
    claimId: row.claimId,
    ownerFence: row.ownerFence,
  }
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

import type {
  DedupeApplication,
  DedupeCompletion,
  DurableStore,
  TimerCompletion,
} from '@openwizard/durable/store'
import {
  normalizeCommitInput,
  normalizeLease,
  readTtl,
  requireIdentifier,
} from './memory-store-input'
import {
  cloneValue,
  compareVersion,
  copyLease,
  copyRecord,
  getOrCreateRow,
  type InternalDedupe,
  isCurrentLease,
  type MemoryStoreState,
  nextFence,
  readNow,
  sameVersion,
  type TimerClaim,
} from './memory-store-internals'

type RecordOperations = Pick<DurableStore, 'acquire' | 'read' | 'renew' | 'release' | 'commit'>

export function createMemoryRecordOperations(state: MemoryStoreState): RecordOperations {
  return {
    async acquire(key, ownerId, leaseOptions) {
      const checkedKey = requireIdentifier(key, 'key')
      const checkedOwnerId = requireIdentifier(ownerId, 'ownerId')
      const ttlMs = readTtl(leaseOptions, state.configuration.leaseTtlMs)
      const now = readNow(state.configuration)
      const row = getOrCreateRow(state.rows, checkedKey)

      if (row.lease !== undefined && row.lease.expiresAt > now) {
        return { ok: false, code: 'LEASE_BUSY', retryAt: row.lease.expiresAt }
      }

      const fence = nextFence(row)
      row.lease = {
        key: checkedKey,
        ownerId: checkedOwnerId,
        fence,
        expiresAt: now + ttlMs,
      }
      return {
        ok: true,
        lease: copyLease(row.lease),
        record: row.record === undefined ? null : copyRecord(row.record),
      }
    },

    async read(key) {
      const checkedKey = requireIdentifier(key, 'key')
      const row = state.rows.get(checkedKey)
      return row?.record === undefined ? null : copyRecord(row.record)
    },

    async renew(lease, leaseOptions) {
      const checkedLease = normalizeLease(lease)
      const ttlMs = readTtl(leaseOptions, state.configuration.leaseTtlMs)
      const now = readNow(state.configuration)
      const row = state.rows.get(checkedLease.key)
      const currentLease = row?.lease
      if (
        row === undefined ||
        currentLease === undefined ||
        !isCurrentLease(row, checkedLease, now)
      ) {
        return { ok: false, code: 'LEASE_LOST' }
      }

      currentLease.expiresAt = now + ttlMs
      return { ok: true, lease: copyLease(currentLease) }
    },

    async release(lease) {
      const checkedLease = normalizeLease(lease)
      const now = readNow(state.configuration)
      const row = state.rows.get(checkedLease.key)
      if (row === undefined || !isCurrentLease(row, checkedLease, now)) {
        return { ok: false, code: 'LEASE_LOST' }
      }

      row.lease = undefined
      return { ok: true }
    },

    async commit(input) {
      const normalized = normalizeCommitInput(input)
      const now = readNow(state.configuration)
      const row = state.rows.get(normalized.lease.key)
      if (row === undefined || !isCurrentLease(row, normalized.lease, now)) {
        return { ok: false, code: 'LEASE_LOST' }
      }

      const actual = row.record?.version ?? null
      if (!sameVersion(actual, normalized.expected)) {
        return {
          ok: false,
          code: 'CAS_CONFLICT',
          actual: actual === null ? null : { ...actual },
        }
      }
      if (
        normalized.next !== undefined &&
        actual !== null &&
        compareVersion(normalized.next.version, actual) <= 0
      ) {
        return { ok: false, code: 'INVALID_VERSION' }
      }

      const fence = normalized.lease.fence
      const applied = normalized.applyDedupe
      if (applied !== undefined && !isOpenClaim(row.dedupe.get(applied.id), applied, fence)) {
        return { ok: false, code: 'DEDUPLICATE_CONFLICT' }
      }
      const dedupeEntry = normalized.completeDedupe
        ? row.dedupe.get(normalized.completeDedupe.id)
        : undefined
      if (
        normalized.completeDedupe !== undefined &&
        !isCompletableDedupe(dedupeEntry, normalized.completeDedupe, fence)
      ) {
        return { ok: false, code: 'DEDUPLICATE_CONFLICT' }
      }

      if (
        normalized.completeTimers.some(
          (completion) =>
            !isCompletableTimer(row.timers.get(completion.timerId), completion, fence),
        )
      ) {
        return { ok: false, code: 'TIMER_CLAIM_LOST' }
      }

      const nextRecord =
        normalized.next === undefined ? undefined : copyRecord(normalized.next, 'next record')
      const dedupeResult =
        normalized.completeDedupe === undefined
          ? undefined
          : cloneValue(normalized.completeDedupe.result, 'dedupe result')

      if (nextRecord !== undefined) row.record = nextRecord
      const appliedClaim = applied === undefined ? undefined : row.dedupe.get(applied.id)
      if (appliedClaim?.status === 'pending') appliedClaim.status = 'applied'
      if (normalized.completeDedupe !== undefined && dedupeEntry !== undefined) {
        row.dedupe.set(normalized.completeDedupe.id, {
          status: 'completed',
          digest: dedupeEntry.digest,
          result: dedupeResult,
          completedAt: now,
        })
      }
      for (const completion of normalized.completeTimers) row.timers.delete(completion.timerId)

      return { ok: true, version: row.record?.version ?? null }
    },
  }
}

/** A pending or applied claim this fence still holds. */
function isOpenClaim(
  entry: InternalDedupe | undefined,
  claim: DedupeApplication,
  fence: string,
): boolean {
  return (
    entry !== undefined &&
    entry.status !== 'completed' &&
    entry.claimId === claim.claimId &&
    entry.ownerFence === fence
  )
}

function isCompletableDedupe(
  entry: InternalDedupe | undefined,
  completion: DedupeCompletion,
  fence: string,
): boolean {
  return isOpenClaim(entry, completion, fence) && entry?.digest === completion.digest
}

function isCompletableTimer(
  entry: TimerClaim | undefined,
  completion: TimerCompletion,
  fence: string,
): boolean {
  return (
    entry !== undefined &&
    entry.timerId === completion.timerId &&
    entry.dueAt === completion.dueAt &&
    sameVersion(entry.expected, completion.expected) &&
    entry.claimId === completion.claimId &&
    entry.ownerFence === fence
  )
}

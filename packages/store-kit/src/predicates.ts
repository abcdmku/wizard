import {
  type DedupeApplication,
  type DedupeCompletion,
  DurableStoreError,
  type Lease,
  type TimerCompletion,
  type Version,
} from '@openwizard/durable/store'

/** The lease a store holds for a key. A released lease is `undefined` or has `null` fields. */
export interface HeldLease {
  readonly ownerId: string | null
  readonly fence: string | null
  readonly expiresAt: number | null
}

/** The fields of a stored command claim the predicates read. A completed claim has no owner. */
export interface DedupeClaimView {
  readonly status: 'pending' | 'applied' | 'completed'
  readonly digest: string
  readonly claimId?: string
  readonly ownerFence?: string
}

/** The fields of a stored timer claim the predicates read. */
export interface TimerClaimView {
  readonly dueAt: number
  readonly expected: Version
  readonly claimId: string
  readonly ownerFence: string
}

/** The caller's lease is the one stored: same owner, same fence, not expired at `now`. */
export function isCurrentLease(
  held: HeldLease | null | undefined,
  lease: Lease,
  now: number,
): boolean {
  return (
    held != null &&
    held.ownerId === lease.ownerId &&
    held.fence === lease.fence &&
    held.expiresAt !== null &&
    held.expiresAt > now
  )
}

/** A pending or applied claim this fence still holds. */
export function isOpenClaim(
  entry: DedupeClaimView | null | undefined,
  claim: DedupeApplication,
  fence: string,
): boolean {
  return (
    entry != null &&
    entry.status !== 'completed' &&
    entry.claimId === claim.claimId &&
    entry.ownerFence === fence
  )
}

/** An open claim of this fence whose digest matches the completion. */
export function isCompletableDedupe(
  entry: DedupeClaimView | null | undefined,
  completion: DedupeCompletion,
  fence: string,
): boolean {
  return isOpenClaim(entry, completion, fence) && entry?.digest === completion.digest
}

/** A timer claim of this fence for the same due time, version and claim id. */
export function isCompletableTimer(
  entry: TimerClaimView | null | undefined,
  completion: TimerCompletion,
  fence: string,
): boolean {
  return (
    entry != null &&
    entry.dueAt === completion.dueAt &&
    sameVersion(entry.expected, completion.expected) &&
    entry.claimId === completion.claimId &&
    entry.ownerFence === fence
  )
}

/** Negative when `left` is older than `right`, zero when equal. */
export function compareVersion(left: Version, right: Version): number {
  return left.epoch - right.epoch || left.seq - right.seq
}

/** Two versions are equal, or both records are absent. */
export function sameVersion(left: Version | null, right: Version | null): boolean {
  return (
    (left === null && right === null) ||
    (left !== null && right !== null && left.epoch === right.epoch && left.seq === right.seq)
  )
}

/** The next value of a fence or claim counter. Throws `FENCE_EXHAUSTED` instead of repeating. */
export function nextCounter(current: number, key: string, name: string): number {
  if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) {
    throw new DurableStoreError('FENCE_EXHAUSTED', `${name} counter exhausted for '${key}'`)
  }
  return current + 1
}

/** JSON text for a value about to be stored. Throws `NOT_SERIALIZABLE` when there is none. */
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

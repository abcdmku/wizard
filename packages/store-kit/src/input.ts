import {
  type CommitInput,
  type DedupeApplication,
  type DedupeClaimInput,
  type DedupeCompletion,
  type DurableRecord,
  DurableStoreError,
  type Lease,
  type TimerClaimInput,
  type TimerCompletion,
  type Version,
} from '@openwizard/durable/store'

/** A commit input whose every field has been checked and copied. */
export interface NormalizedCommitInput {
  readonly lease: Lease
  readonly expected: Version | null
  readonly next: DurableRecord | undefined
  readonly applyDedupe: DedupeApplication | undefined
  readonly completeDedupe: DedupeCompletion | undefined
  readonly completeTimers: readonly TimerCompletion[]
}

/** A key, owner, fence or claim id: a non-empty string. */
export function requireIdentifier(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DurableStoreError('INVALID_ARGUMENT', `${name} must be a non-empty string`)
  }
  return value
}

/** Check a lease a caller handed back and copy the four fields the store reads. */
export function normalizeLease(value: Lease): Lease {
  if (typeof value !== 'object' || value === null) {
    throw new DurableStoreError('INVALID_ARGUMENT', 'lease must be an object')
  }
  const key = requireIdentifier(value.key, 'lease.key')
  const ownerId = requireIdentifier(value.ownerId, 'lease.ownerId')
  const fence = requireIdentifier(value.fence, 'lease.fence')
  const expiresAt = requireFiniteNumber(value.expiresAt, 'lease.expiresAt')
  return { key, ownerId, fence, expiresAt }
}

/** Check a record version: two non-negative safe integers. */
export function normalizeVersion(value: Version, name: string): Version {
  if (typeof value !== 'object' || value === null) {
    throw new DurableStoreError('INVALID_VERSION', `${name} must be an object`)
  }
  if (
    !Number.isSafeInteger(value.epoch) ||
    value.epoch < 0 ||
    !Number.isSafeInteger(value.seq) ||
    value.seq < 0
  ) {
    throw new DurableStoreError(
      'INVALID_VERSION',
      `${name} must contain non-negative safe integers`,
    )
  }
  return { epoch: value.epoch, seq: value.seq }
}

/**
 * Check a commit. The lease and expected version are checked first, then the record and the
 * completion markers. A commit that writes nothing throws `NOTHING_TO_COMMIT`.
 */
export function normalizeCommitInput(input: CommitInput): NormalizedCommitInput {
  if (typeof input !== 'object' || input === null) {
    throw new DurableStoreError('INVALID_ARGUMENT', 'commit input must be an object')
  }
  const lease = normalizeLease(input.lease)
  const expected = input.expected === null ? null : normalizeVersion(input.expected, 'expected')
  const next = input.next === undefined ? undefined : normalizeRecord(input.next, 'next')
  const applyDedupe =
    input.applyDedupe === undefined ? undefined : normalizeDedupeApplication(input.applyDedupe)
  if (applyDedupe !== undefined && next === undefined) {
    throw new DurableStoreError('INVALID_ARGUMENT', 'applyDedupe needs the next record')
  }
  const completeDedupe =
    input.completeDedupe === undefined ? undefined : normalizeDedupeCompletion(input.completeDedupe)
  const completeTimers = (input.completeTimers ?? []).map(normalizeTimerCompletion)
  if (next === undefined && completeDedupe === undefined && completeTimers.length === 0) {
    throw new DurableStoreError('NOTHING_TO_COMMIT', 'commit needs a record or completion marker')
  }
  return { lease, expected, next, applyDedupe, completeDedupe, completeTimers }
}

/** Check a command claim. `request` is kept only when the caller passed the key. */
export function normalizeDedupeClaimInput(input: DedupeClaimInput): DedupeClaimInput {
  if (typeof input !== 'object' || input === null) {
    throw new DurableStoreError('INVALID_ARGUMENT', 'dedupe claim input must be an object')
  }
  return {
    lease: normalizeLease(input.lease),
    id: requireIdentifier(input.id, 'dedupe id'),
    digest: requireIdentifier(input.digest, 'dedupe digest'),
    ...(input.expectedVersion === undefined
      ? {}
      : { expectedVersion: normalizeVersion(input.expectedVersion, 'expectedVersion') }),
    ...('request' in input ? { request: input.request } : {}),
  }
}

/** Check a timer claim. */
export function normalizeTimerClaimInput(input: TimerClaimInput): TimerClaimInput {
  if (typeof input !== 'object' || input === null) {
    throw new DurableStoreError('INVALID_ARGUMENT', 'timer claim input must be an object')
  }
  return {
    lease: normalizeLease(input.lease),
    timerId: requireIdentifier(input.timerId, 'timerId'),
    dueAt: requireFiniteNumber(input.dueAt, 'dueAt'),
    expected: normalizeVersion(input.expected, 'expected'),
  }
}

function normalizeRecord(value: DurableRecord, name: string): DurableRecord {
  if (typeof value !== 'object' || value === null) {
    throw new DurableStoreError('INVALID_ARGUMENT', `${name} must be an object`)
  }
  if (!('value' in value)) {
    throw new DurableStoreError('INVALID_ARGUMENT', `${name}.value is required`)
  }
  if (value.version === undefined) {
    throw new DurableStoreError('INVALID_VERSION', `${name}.version is required`)
  }
  return { value: value.value, version: normalizeVersion(value.version, `${name}.version`) }
}

function normalizeDedupeApplication(input: DedupeApplication): DedupeApplication {
  if (typeof input !== 'object' || input === null) {
    throw new DurableStoreError('INVALID_ARGUMENT', 'dedupe application must be an object')
  }
  return {
    id: requireIdentifier(input.id, 'dedupe id'),
    claimId: requireIdentifier(input.claimId, 'dedupe claimId'),
  }
}

function normalizeDedupeCompletion(input: DedupeCompletion): DedupeCompletion {
  if (typeof input !== 'object' || input === null) {
    throw new DurableStoreError('INVALID_ARGUMENT', 'dedupe completion must be an object')
  }
  return {
    id: requireIdentifier(input.id, 'dedupe id'),
    digest: requireIdentifier(input.digest, 'dedupe digest'),
    claimId: requireIdentifier(input.claimId, 'dedupe claimId'),
    result: input.result,
  }
}

function normalizeTimerCompletion(input: TimerCompletion): TimerCompletion {
  if (typeof input !== 'object' || input === null) {
    throw new DurableStoreError('INVALID_ARGUMENT', 'timer completion must be an object')
  }
  return {
    timerId: requireIdentifier(input.timerId, 'timerId'),
    dueAt: requireFiniteNumber(input.dueAt, 'dueAt'),
    expected: normalizeVersion(input.expected, 'timer completion expected'),
    claimId: requireIdentifier(input.claimId, 'timer claimId'),
  }
}

function requireFiniteNumber(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new DurableStoreError('INVALID_ARGUMENT', `${name} must be a finite number`)
  }
  return value
}

import type {
  CommitInput,
  DedupeClaimInput,
  Lease,
  TimerClaimInput,
  Version,
} from '@openwizard/durable/store'
import { DurableStoreError } from '@openwizard/durable/store'
import type { NormalizedCommitInput } from './store-types'

export function requireIdentifier(value: string, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DurableStoreError('INVALID_ARGUMENT', `${name} must be a non-empty string`)
  }
  return value
}

export function normalizeLease(lease: Lease): Lease {
  if (typeof lease !== 'object' || lease === null) {
    throw new DurableStoreError('INVALID_ARGUMENT', 'lease must be an object')
  }
  return {
    key: requireIdentifier(lease.key, 'lease.key'),
    ownerId: requireIdentifier(lease.ownerId, 'lease.ownerId'),
    fence: requireIdentifier(lease.fence, 'lease.fence'),
    expiresAt: requireFinite(lease.expiresAt, 'lease.expiresAt'),
  }
}

function normalizeVersion(version: Version, name: string): Version {
  if (
    typeof version !== 'object' ||
    version === null ||
    !Number.isSafeInteger(version.epoch) ||
    version.epoch < 0 ||
    !Number.isSafeInteger(version.seq) ||
    version.seq < 0
  ) {
    throw new DurableStoreError(
      'INVALID_VERSION',
      `${name} must contain non-negative safe integers`,
    )
  }
  return { epoch: version.epoch, seq: version.seq }
}

export function normalizeCommitInput(input: CommitInput): NormalizedCommitInput {
  if (typeof input !== 'object' || input === null) {
    throw new DurableStoreError('INVALID_ARGUMENT', 'commit input must be an object')
  }
  const next =
    input.next === undefined
      ? undefined
      : {
          value: input.next.value,
          version: normalizeVersion(input.next.version, 'next.version'),
        }
  const applyDedupe =
    input.applyDedupe === undefined
      ? undefined
      : {
          id: requireIdentifier(input.applyDedupe.id, 'dedupe id'),
          claimId: requireIdentifier(input.applyDedupe.claimId, 'dedupe claimId'),
        }
  if (applyDedupe !== undefined && next === undefined) {
    throw new DurableStoreError('INVALID_ARGUMENT', 'applyDedupe needs the next record')
  }
  const completeDedupe =
    input.completeDedupe === undefined
      ? undefined
      : {
          id: requireIdentifier(input.completeDedupe.id, 'dedupe id'),
          digest: requireIdentifier(input.completeDedupe.digest, 'dedupe digest'),
          claimId: requireIdentifier(input.completeDedupe.claimId, 'dedupe claimId'),
          result: input.completeDedupe.result,
        }
  const completeTimers = (input.completeTimers ?? []).map((completion) => ({
    timerId: requireIdentifier(completion.timerId, 'timerId'),
    dueAt: requireFinite(completion.dueAt, 'dueAt'),
    expected: normalizeVersion(completion.expected, 'timer expected'),
    claimId: requireIdentifier(completion.claimId, 'timer claimId'),
  }))
  if (next === undefined && completeDedupe === undefined && completeTimers.length === 0) {
    throw new DurableStoreError('NOTHING_TO_COMMIT', 'commit needs a record or completion marker')
  }
  return {
    lease: normalizeLease(input.lease),
    expected: input.expected === null ? null : normalizeVersion(input.expected, 'expected'),
    next,
    applyDedupe,
    completeDedupe,
    completeTimers,
  }
}

export function normalizeDedupeClaimInput(input: DedupeClaimInput): DedupeClaimInput {
  if (typeof input !== 'object' || input === null) {
    throw new DurableStoreError('INVALID_ARGUMENT', 'dedupe claim input must be an object')
  }
  const expectedVersion =
    input.expectedVersion === undefined
      ? undefined
      : normalizeVersion(input.expectedVersion, 'expectedVersion')
  return {
    lease: normalizeLease(input.lease),
    id: requireIdentifier(input.id, 'dedupe id'),
    digest: requireIdentifier(input.digest, 'dedupe digest'),
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    request: input.request,
  }
}

export function normalizeTimerClaimInput(input: TimerClaimInput): TimerClaimInput {
  if (typeof input !== 'object' || input === null) {
    throw new DurableStoreError('INVALID_ARGUMENT', 'timer claim input must be an object')
  }
  return {
    lease: normalizeLease(input.lease),
    timerId: requireIdentifier(input.timerId, 'timerId'),
    dueAt: requireFinite(input.dueAt, 'dueAt'),
    expected: normalizeVersion(input.expected, 'expected'),
  }
}

function requireFinite(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new DurableStoreError('INVALID_ARGUMENT', `${name} must be a finite number`)
  }
  return value
}

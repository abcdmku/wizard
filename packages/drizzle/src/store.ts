import {
  type CommitInput,
  type DedupeClaimInput,
  type DedupeCompletion,
  type DurableRecord,
  type DurableStore,
  DurableStoreError,
  type Lease,
  type LeaseOptions,
  type RetentionPolicy,
  type RetentionSweepOptions,
  type TimerClaimInput,
  type TimerCompletion,
  type Version,
} from '@openwizard/durable'

const DEFAULT_LEASE_TTL_MS = 30_000
const DEFAULT_TIMER_CLAIM_TTL_MS = 30_000
const DEFAULT_DEDUPE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_TIMER_RETENTION_MS = 5 * 60 * 1000

/** Options shared by the Drizzle durable-store adapters. @public */
export interface DrizzleDurableStoreOptions {
  readonly now?: () => number
  readonly leaseTtlMs?: number
  readonly timerClaimTtlMs?: number
  readonly retention?: RetentionPolicy
}

export interface RunRow {
  key: string
  fenceCounter: number
  claimCounter: number
  ownerId: string | null
  fence: string | null
  leaseExpiresAt: number | null
  snapshotEpoch: number | null
  snapshotSeq: number | null
  snapshot: string | null
}

export interface DedupeRow {
  runKey: string
  kind: 'command' | 'event'
  dedupeId: string
  digest: string
  status: 'pending' | 'completed'
  claimId: string
  ownerFence: string
  claimedAt: number
  request: string | null
  result: string | null
  completedAt: number | null
}

export interface TimerRow {
  runKey: string
  timerId: string
  dueAt: number
  expectedEpoch: number
  expectedSeq: number
  claimId: string
  ownerFence: string
  claimedUntil: number
}

export type RunPatch = Partial<Omit<RunRow, 'key'>>

export interface LockedRunRepository {
  readonly row: RunRow
  updateRun(patch: RunPatch): Promise<void>
  readDedupe(kind: 'command' | 'event', id: string): Promise<DedupeRow | null>
  insertDedupe(row: DedupeRow): Promise<void>
  updateDedupe(kind: 'command' | 'event', id: string, row: Partial<DedupeRow>): Promise<void>
  readTimer(timerId: string): Promise<TimerRow | null>
  putTimer(row: TimerRow): Promise<void>
  deleteTimer(timerId: string): Promise<void>
}

export interface DrizzleDurableRepository {
  readRun(key: string): Promise<RunRow | null>
  withLockedRun<Result>(
    key: string,
    create: boolean,
    operation: (run: LockedRunRepository) => Promise<Result>,
  ): Promise<{ readonly found: true; readonly value: Result } | { readonly found: false }>
  sweep(input: {
    readonly dedupeCompletedBefore: number
    readonly timerClaimedBefore: number
    readonly limit: number
  }): Promise<{ readonly dedupeRemoved: number; readonly timerClaimsRemoved: number }>
}

interface Configuration {
  now: () => number
  leaseTtlMs: number
  timerClaimTtlMs: number
  completedDedupeMs: number
  timerClaimMs: number
}

export function createDrizzleDurableStore(
  repository: DrizzleDurableRepository,
  options: DrizzleDurableStoreOptions = {},
): DurableStore {
  const configuration = makeConfiguration(options)

  return {
    async acquire(key, ownerId, leaseOptions) {
      const checkedKey = requireIdentifier(key, 'key')
      const checkedOwnerId = requireIdentifier(ownerId, 'ownerId')
      const ttlMs = readTtl(leaseOptions, configuration.leaseTtlMs)
      const now = readNow(configuration)

      const result = await repository.withLockedRun(checkedKey, true, async (run) => {
        if (hasLiveLease(run.row, now)) {
          return {
            ok: false as const,
            code: 'LEASE_BUSY' as const,
            retryAt: run.row.leaseExpiresAt as number,
          }
        }

        const fenceCounter = nextCounter(run.row.fenceCounter, checkedKey, 'fence')
        const fence = String(fenceCounter)
        const expiresAt = now + ttlMs
        await run.updateRun({
          fenceCounter,
          ownerId: checkedOwnerId,
          fence,
          leaseExpiresAt: expiresAt,
        })
        return {
          ok: true as const,
          lease: { key: checkedKey, ownerId: checkedOwnerId, fence, expiresAt },
          record: recordFromRow(run.row),
        }
      })

      if (!result.found) {
        throw new DurableStoreError('INVALID_ARGUMENT', 'the adapter could not create its run row')
      }
      return result.value
    },

    async read(key) {
      const row = await repository.readRun(requireIdentifier(key, 'key'))
      return row === null ? null : recordFromRow(row)
    },

    async renew(lease, leaseOptions) {
      const checkedLease = normalizeLease(lease)
      const ttlMs = readTtl(leaseOptions, configuration.leaseTtlMs)
      const now = readNow(configuration)
      const result = await repository.withLockedRun(checkedLease.key, false, async (run) => {
        if (!isCurrentLease(run.row, checkedLease, now)) {
          return { ok: false as const, code: 'LEASE_LOST' as const }
        }
        const expiresAt = now + ttlMs
        await run.updateRun({ leaseExpiresAt: expiresAt })
        return { ok: true as const, lease: { ...checkedLease, expiresAt } }
      })
      return result.found ? result.value : { ok: false, code: 'LEASE_LOST' }
    },

    async release(lease) {
      const checkedLease = normalizeLease(lease)
      const now = readNow(configuration)
      const result = await repository.withLockedRun(checkedLease.key, false, async (run) => {
        if (!isCurrentLease(run.row, checkedLease, now)) {
          return { ok: false as const, code: 'LEASE_LOST' as const }
        }
        await run.updateRun({ ownerId: null, fence: null, leaseExpiresAt: null })
        return { ok: true as const }
      })
      return result.found ? result.value : { ok: false, code: 'LEASE_LOST' }
    },

    async commit(input) {
      const normalized = normalizeCommitInput(input)
      const now = readNow(configuration)
      const result = await repository.withLockedRun(normalized.lease.key, false, async (run) => {
        if (!isCurrentLease(run.row, normalized.lease, now)) {
          return { ok: false as const, code: 'LEASE_LOST' as const }
        }

        const actual = versionFromRow(run.row)
        if (!sameVersion(actual, normalized.expected)) {
          return { ok: false as const, code: 'CAS_CONFLICT' as const, actual }
        }
        if (
          normalized.next !== undefined &&
          actual !== null &&
          compareVersion(normalized.next.version, actual) <= 0
        ) {
          return { ok: false as const, code: 'INVALID_VERSION' as const }
        }

        const dedupe =
          normalized.completeDedupe === undefined
            ? null
            : await run.readDedupe(normalized.completeDedupe.kind, normalized.completeDedupe.id)
        if (
          normalized.completeDedupe !== undefined &&
          !isCompletableDedupe(dedupe, normalized.completeDedupe, normalized.lease.fence)
        ) {
          return { ok: false as const, code: 'DEDUPLICATE_CONFLICT' as const }
        }

        const timer =
          normalized.completeTimer === undefined
            ? null
            : await run.readTimer(normalized.completeTimer.timerId)
        if (
          normalized.completeTimer !== undefined &&
          !isCompletableTimer(timer, normalized.completeTimer, normalized.lease.fence)
        ) {
          return { ok: false as const, code: 'TIMER_CLAIM_LOST' as const }
        }

        const snapshot =
          normalized.next === undefined
            ? undefined
            : serializeJson(normalized.next.value, 'next record')
        const dedupeResult =
          normalized.completeDedupe === undefined
            ? undefined
            : serializeJson(normalized.completeDedupe.result, 'dedupe result')

        if (normalized.next !== undefined && snapshot !== undefined) {
          await run.updateRun({
            snapshotEpoch: normalized.next.version.epoch,
            snapshotSeq: normalized.next.version.seq,
            snapshot,
          })
        }
        if (normalized.completeDedupe !== undefined && dedupeResult !== undefined) {
          await run.updateDedupe(normalized.completeDedupe.kind, normalized.completeDedupe.id, {
            status: 'completed',
            result: dedupeResult,
            completedAt: now,
          })
        }
        if (normalized.completeTimer !== undefined) {
          await run.deleteTimer(normalized.completeTimer.timerId)
        }

        return {
          ok: true as const,
          version: normalized.next?.version ?? actual,
        }
      })
      return result.found ? result.value : { ok: false, code: 'LEASE_LOST' }
    },

    async claimDedupe(input) {
      const normalized = normalizeDedupeClaimInput(input)
      const now = readNow(configuration)
      const result = await repository.withLockedRun(normalized.lease.key, false, async (run) => {
        if (!isCurrentLease(run.row, normalized.lease, now)) {
          return { ok: false as const, code: 'LEASE_LOST' as const }
        }

        const existing = await run.readDedupe(normalized.kind, normalized.id)
        if (existing?.status === 'completed') {
          if (existing.digest !== normalized.digest) {
            return {
              ok: false as const,
              code: 'DEDUPLICATE_CONFLICT' as const,
              existingDigest: existing.digest,
            }
          }
          return {
            ok: true as const,
            status: 'completed' as const,
            digest: existing.digest,
            result: parseJson(existing.result, 'dedupe result'),
          }
        }
        if (existing !== null && existing.digest !== normalized.digest) {
          return {
            ok: false as const,
            code: 'DEDUPLICATE_CONFLICT' as const,
            existingDigest: existing.digest,
          }
        }
        if (existing?.status === 'pending' && existing.ownerFence === normalized.lease.fence) {
          const request = parseOptionalJson(existing.request, 'dedupe request')
          return {
            ok: true as const,
            status: 'pending' as const,
            claimId: existing.claimId,
            ownerFence: existing.ownerFence,
            claimedAt: existing.claimedAt,
            ...(request === undefined ? {} : { request }),
          }
        }

        const claimCounter = nextCounter(run.row.claimCounter, run.row.key, 'claim')
        const claimId = `dedupe:${claimCounter}`
        const request =
          normalized.request === undefined
            ? (existing?.request ?? null)
            : serializeJson(normalized.request, 'dedupe request')
        await run.updateRun({ claimCounter })
        const row: DedupeRow = {
          runKey: run.row.key,
          kind: normalized.kind,
          dedupeId: normalized.id,
          digest: normalized.digest,
          status: 'pending',
          claimId,
          ownerFence: normalized.lease.fence,
          claimedAt: now,
          request,
          result: null,
          completedAt: null,
        }
        if (existing === null) await run.insertDedupe(row)
        else await run.updateDedupe(normalized.kind, normalized.id, row)
        const requestResult = parseOptionalJson(request, 'dedupe request')
        return {
          ok: true as const,
          status: 'claimed' as const,
          claimId,
          ...(requestResult === undefined ? {} : { request: requestResult }),
        }
      })
      return result.found ? result.value : { ok: false, code: 'LEASE_LOST' }
    },

    async claimTimer(input) {
      const normalized = normalizeTimerClaimInput(input)
      const now = readNow(configuration)
      const result = await repository.withLockedRun(normalized.lease.key, false, async (run) => {
        if (!isCurrentLease(run.row, normalized.lease, now)) {
          return { ok: false as const, code: 'LEASE_LOST' as const }
        }

        const actual = versionFromRow(run.row)
        if (!sameVersion(actual, normalized.expected)) {
          return { ok: false as const, code: 'TIMER_STALE' as const, actual }
        }
        if (now < normalized.dueAt) {
          return { ok: false as const, code: 'TIMER_NOT_DUE' as const, dueAt: normalized.dueAt }
        }

        const existing = await run.readTimer(normalized.timerId)
        const sameTimer =
          existing !== null &&
          existing.dueAt === normalized.dueAt &&
          sameVersion(
            { epoch: existing.expectedEpoch, seq: existing.expectedSeq },
            normalized.expected,
          )
        if (
          sameTimer &&
          existing.ownerFence === normalized.lease.fence &&
          existing.claimedUntil > now
        ) {
          return {
            ok: false as const,
            code: 'TIMER_ALREADY_CLAIMED' as const,
            claimId: existing.claimId,
            ownerFence: existing.ownerFence,
            claimedUntil: existing.claimedUntil,
          }
        }

        const claimCounter = nextCounter(run.row.claimCounter, run.row.key, 'claim')
        const claimId = `timer:${claimCounter}`
        const claimedUntil = Math.min(
          now + configuration.timerClaimTtlMs,
          normalized.lease.expiresAt,
        )
        await run.updateRun({ claimCounter })
        await run.putTimer({
          runKey: run.row.key,
          timerId: normalized.timerId,
          dueAt: normalized.dueAt,
          expectedEpoch: normalized.expected.epoch,
          expectedSeq: normalized.expected.seq,
          claimId,
          ownerFence: normalized.lease.fence,
          claimedUntil,
        })
        return {
          ok: true as const,
          claimId,
          timerId: normalized.timerId,
          dueAt: normalized.dueAt,
          expected: normalized.expected,
        }
      })
      return result.found ? result.value : { ok: false, code: 'LEASE_LOST' }
    },

    async sweep(options) {
      const limit = readLimit(options)
      const now = readNow(configuration)
      return repository.sweep({
        dedupeCompletedBefore: now - configuration.completedDedupeMs,
        timerClaimedBefore: now - configuration.timerClaimMs,
        limit,
      })
    },
  }
}

function makeConfiguration(options: DrizzleDurableStoreOptions): Configuration {
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

function readNow(configuration: Configuration): number {
  const now = configuration.now()
  if (!Number.isFinite(now)) {
    throw new DurableStoreError('INVALID_ARGUMENT', 'the store clock must return a finite number')
  }
  return now
}

function readTtl(options: LeaseOptions | undefined, fallback: number): number {
  return requirePositiveFinite(options?.ttlMs ?? fallback, 'ttlMs')
}

function readLimit(options: RetentionSweepOptions | undefined): number {
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

function requireIdentifier(value: string, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DurableStoreError('INVALID_ARGUMENT', `${name} must be a non-empty string`)
  }
  return value
}

function normalizeLease(lease: Lease): Lease {
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

function normalizeCommitInput(input: CommitInput): {
  lease: Lease
  expected: Version | null
  next: DurableRecord | undefined
  completeDedupe: DedupeCompletion | undefined
  completeTimer: TimerCompletion | undefined
} {
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
  const completeDedupe =
    input.completeDedupe === undefined
      ? undefined
      : {
          kind: requireDedupeKind(input.completeDedupe.kind),
          id: requireIdentifier(input.completeDedupe.id, 'dedupe id'),
          digest: requireIdentifier(input.completeDedupe.digest, 'dedupe digest'),
          claimId: requireIdentifier(input.completeDedupe.claimId, 'dedupe claimId'),
          result: input.completeDedupe.result,
        }
  const completeTimer =
    input.completeTimer === undefined
      ? undefined
      : {
          timerId: requireIdentifier(input.completeTimer.timerId, 'timerId'),
          dueAt: requireFinite(input.completeTimer.dueAt, 'dueAt'),
          expected: normalizeVersion(input.completeTimer.expected, 'timer expected'),
          claimId: requireIdentifier(input.completeTimer.claimId, 'timer claimId'),
        }
  if (next === undefined && completeDedupe === undefined && completeTimer === undefined) {
    throw new DurableStoreError('NOTHING_TO_COMMIT', 'commit needs a record or completion marker')
  }
  return {
    lease: normalizeLease(input.lease),
    expected: input.expected === null ? null : normalizeVersion(input.expected, 'expected'),
    next,
    completeDedupe,
    completeTimer,
  }
}

function normalizeDedupeClaimInput(input: DedupeClaimInput): DedupeClaimInput {
  if (typeof input !== 'object' || input === null) {
    throw new DurableStoreError('INVALID_ARGUMENT', 'dedupe claim input must be an object')
  }
  return {
    lease: normalizeLease(input.lease),
    kind: requireDedupeKind(input.kind),
    id: requireIdentifier(input.id, 'dedupe id'),
    digest: requireIdentifier(input.digest, 'dedupe digest'),
    request: input.request,
  }
}

function normalizeTimerClaimInput(input: TimerClaimInput): TimerClaimInput {
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

function requireDedupeKind(kind: string): 'command' | 'event' {
  if (kind !== 'command' && kind !== 'event') {
    throw new DurableStoreError('INVALID_ARGUMENT', 'dedupe kind must be command or event')
  }
  return kind
}

function requireFinite(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new DurableStoreError('INVALID_ARGUMENT', `${name} must be a finite number`)
  }
  return value
}

function nextCounter(current: number, key: string, name: string): number {
  if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) {
    throw new DurableStoreError('FENCE_EXHAUSTED', `${name} counter exhausted for '${key}'`)
  }
  return current + 1
}

function hasLiveLease(row: RunRow, now: number): boolean {
  return (
    row.ownerId !== null &&
    row.fence !== null &&
    row.leaseExpiresAt !== null &&
    row.leaseExpiresAt > now
  )
}

function isCurrentLease(row: RunRow, lease: Lease, now: number): boolean {
  return (
    row.ownerId === lease.ownerId &&
    row.fence === lease.fence &&
    row.leaseExpiresAt !== null &&
    row.leaseExpiresAt > now
  )
}

function versionFromRow(row: RunRow): Version | null {
  if (row.snapshotEpoch === null || row.snapshotSeq === null || row.snapshot === null) return null
  return { epoch: row.snapshotEpoch, seq: row.snapshotSeq }
}

function recordFromRow(row: RunRow): DurableRecord | null {
  const version = versionFromRow(row)
  if (version === null || row.snapshot === null) return null
  return { value: parseJson(row.snapshot, 'stored snapshot'), version }
}

function serializeJson(value: unknown, name: string): string {
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

function parseJson(value: string | null, name: string): unknown {
  if (value === null) {
    throw new DurableStoreError('INVALID_ARGUMENT', `${name} is missing from durable storage`)
  }
  try {
    return JSON.parse(value)
  } catch {
    throw new DurableStoreError('INVALID_ARGUMENT', `${name} is not valid JSON`)
  }
}

function parseOptionalJson(value: string | null, name: string): unknown {
  return value === null ? undefined : parseJson(value, name)
}

function isCompletableDedupe(
  row: DedupeRow | null,
  completion: DedupeCompletion,
  fence: string,
): boolean {
  return (
    row?.status === 'pending' &&
    row.digest === completion.digest &&
    row.claimId === completion.claimId &&
    row.ownerFence === fence
  )
}

function isCompletableTimer(
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

function compareVersion(left: Version, right: Version): number {
  return left.epoch - right.epoch || left.seq - right.seq
}

function sameVersion(left: Version | null, right: Version | null): boolean {
  return (
    (left === null && right === null) ||
    (left !== null && right !== null && left.epoch === right.epoch && left.seq === right.seq)
  )
}

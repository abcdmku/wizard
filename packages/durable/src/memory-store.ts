import {
  type CommitInput,
  type DedupeClaimInput,
  type DedupeCompletion,
  type DurableRecord,
  DurableStoreError,
  type Lease,
  type LeaseOptions,
  type MemoryDurableStore,
  type MemoryDurableStoreOptions,
  type RetentionSweepOptions,
  type TimerClaimInput,
  type TimerCompletion,
  type Version,
} from './contracts'

const DEFAULT_LEASE_TTL_MS = 30_000
const DEFAULT_TIMER_CLAIM_TTL_MS = 30_000
const DEFAULT_DEDUPE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_TIMER_RETENTION_MS = 5 * 60 * 1000

interface InternalLease {
  key: string
  ownerId: string
  fence: string
  expiresAt: number
}

interface PendingDedupe {
  status: 'pending'
  digest: string
  claimId: string
  ownerFence: string
  claimedAt: number
  request?: unknown
}

interface CompletedDedupe {
  status: 'completed'
  digest: string
  result: unknown
  completedAt: number
}

type InternalDedupe = PendingDedupe | CompletedDedupe

interface TimerClaim {
  timerId: string
  dueAt: number
  expected: Version
  claimId: string
  ownerFence: string
  claimedUntil: number
}

interface Row {
  key: string
  fenceCounter: number
  claimCounter: number
  lease: InternalLease | undefined
  record?: DurableRecord
  dedupe: Map<string, InternalDedupe>
  timers: Map<string, TimerClaim>
}

interface Configuration {
  now: () => number
  leaseTtlMs: number
  timerClaimTtlMs: number
  completedDedupeMs: number
  timerClaimMs: number
}

/**
 * In-memory `DurableStore` with synchronous linearization points and JSON
 * round trips at every persistence boundary.
 *
 * @public
 */
export function createMemoryDurableStore(
  options: MemoryDurableStoreOptions = {},
): MemoryDurableStore {
  const configuration = makeConfiguration(options)
  const rows = new Map<string, Row>()

  const store: MemoryDurableStore = {
    async acquire(key, ownerId, leaseOptions) {
      const checkedKey = requireIdentifier(key, 'key')
      const checkedOwnerId = requireIdentifier(ownerId, 'ownerId')
      const ttlMs = readTtl(leaseOptions, configuration.leaseTtlMs)
      const now = readNow(configuration)
      const row = getOrCreateRow(rows, checkedKey)

      if (row.lease !== undefined && row.lease.expiresAt > now) {
        return { ok: false, code: 'LEASE_BUSY', retryAt: row.lease.expiresAt }
      }

      const fence = nextFence(row)
      const lease: InternalLease = {
        key: checkedKey,
        ownerId: checkedOwnerId,
        fence,
        expiresAt: now + ttlMs,
      }
      row.lease = lease
      return {
        ok: true,
        lease: copyLease(lease),
        record: row.record === undefined ? null : copyRecord(row.record),
      }
    },

    async read(key) {
      const checkedKey = requireIdentifier(key, 'key')
      const row = rows.get(checkedKey)
      return row?.record === undefined ? null : copyRecord(row.record)
    },

    async renew(lease, leaseOptions) {
      const checkedLease = normalizeLease(lease)
      const ttlMs = readTtl(leaseOptions, configuration.leaseTtlMs)
      const now = readNow(configuration)
      const row = rows.get(checkedLease.key)
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
      const now = readNow(configuration)
      const row = rows.get(checkedLease.key)
      if (row === undefined || !isCurrentLease(row, checkedLease, now)) {
        return { ok: false, code: 'LEASE_LOST' }
      }

      row.lease = undefined
      return { ok: true }
    },

    async commit(input) {
      const normalized = normalizeCommitInput(input)
      const now = readNow(configuration)
      const row = rows.get(normalized.lease.key)
      if (row === undefined || !isCurrentLease(row, normalized.lease, now)) {
        return { ok: false, code: 'LEASE_LOST' }
      }

      const actual = row.record?.version ?? null
      if (!sameVersion(actual, normalized.expected)) {
        return { ok: false, code: 'CAS_CONFLICT', actual: copyNullableVersion(actual) }
      }

      if (
        normalized.next !== undefined &&
        actual !== null &&
        compareVersion(normalized.next.version, actual) <= 0
      ) {
        return { ok: false, code: 'INVALID_VERSION' }
      }

      const dedupeEntry = normalized.completeDedupe
        ? row.dedupe.get(dedupeKey(normalized.completeDedupe.kind, normalized.completeDedupe.id))
        : undefined
      if (
        normalized.completeDedupe !== undefined &&
        !isCompletableDedupe(dedupeEntry, normalized.completeDedupe, normalized.lease.fence)
      ) {
        return { ok: false, code: 'DEDUPLICATE_CONFLICT' }
      }

      const timerEntry = normalized.completeTimer
        ? row.timers.get(normalized.completeTimer.timerId)
        : undefined
      if (
        normalized.completeTimer !== undefined &&
        !isCompletableTimer(timerEntry, normalized.completeTimer, normalized.lease.fence)
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
      if (normalized.completeDedupe !== undefined && dedupeEntry !== undefined) {
        const completed: CompletedDedupe = {
          status: 'completed',
          digest: dedupeEntry.digest,
          result: dedupeResult,
          completedAt: now,
        }
        row.dedupe.set(
          dedupeKey(normalized.completeDedupe.kind, normalized.completeDedupe.id),
          completed,
        )
      }
      if (normalized.completeTimer !== undefined) {
        row.timers.delete(normalized.completeTimer.timerId)
      }

      return { ok: true, version: row.record?.version ?? null }
    },

    async claimDedupe(input) {
      const normalized = normalizeDedupeClaimInput(input)
      const now = readNow(configuration)
      const row = rows.get(normalized.lease.key)
      if (row === undefined || !isCurrentLease(row, normalized.lease, now)) {
        return { ok: false, code: 'LEASE_LOST' }
      }

      const key = dedupeKey(normalized.kind, normalized.id)
      const existing = row.dedupe.get(key)
      if (existing?.status === 'completed') {
        if (existing.digest !== normalized.digest) {
          return {
            ok: false,
            code: 'DEDUPLICATE_CONFLICT',
            existingDigest: existing.digest,
          }
        }
        return {
          ok: true,
          status: 'completed',
          digest: existing.digest,
          result: cloneValue(existing.result, 'dedupe result'),
        }
      }

      if (existing !== undefined && existing.digest !== normalized.digest) {
        return {
          ok: false,
          code: 'DEDUPLICATE_CONFLICT',
          existingDigest: existing.digest,
        }
      }

      if (existing?.status === 'pending' && existing.ownerFence === normalized.lease.fence) {
        const request = copyOptionalValue(existing.request, 'dedupe request')
        return {
          ok: true,
          status: 'pending',
          claimId: existing.claimId,
          ownerFence: existing.ownerFence,
          claimedAt: existing.claimedAt,
          ...(request === undefined ? {} : { request }),
        }
      }

      const claimId = nextClaimId(row, 'dedupe')
      const request = readRequest(normalized.request, existing)
      const pending: PendingDedupe = {
        status: 'pending',
        digest: normalized.digest,
        claimId,
        ownerFence: normalized.lease.fence,
        claimedAt: now,
      }
      if (request !== undefined) pending.request = request
      row.dedupe.set(key, pending)
      const requestResult = copyOptionalValue(request, 'dedupe request')
      return {
        ok: true,
        status: 'claimed',
        claimId,
        ...(requestResult === undefined ? {} : { request: requestResult }),
      }
    },

    async claimTimer(input) {
      const normalized = normalizeTimerClaimInput(input)
      const now = readNow(configuration)
      const row = rows.get(normalized.lease.key)
      const currentLease = row?.lease
      if (
        row === undefined ||
        currentLease === undefined ||
        !isCurrentLease(row, normalized.lease, now)
      ) {
        return { ok: false, code: 'LEASE_LOST' }
      }

      const actual = row.record?.version ?? null
      if (!sameVersion(actual, normalized.expected)) {
        return { ok: false, code: 'TIMER_STALE', actual: copyNullableVersion(actual) }
      }
      if (now < normalized.dueAt) {
        return { ok: false, code: 'TIMER_NOT_DUE', dueAt: normalized.dueAt }
      }

      const existing = row.timers.get(normalized.timerId)
      const sameTimer =
        existing !== undefined &&
        existing.dueAt === normalized.dueAt &&
        sameVersion(existing.expected, normalized.expected)
      if (
        sameTimer &&
        existing.ownerFence === normalized.lease.fence &&
        existing.claimedUntil > now
      ) {
        return {
          ok: false,
          code: 'TIMER_ALREADY_CLAIMED',
          claimId: existing.claimId,
          ownerFence: existing.ownerFence,
          claimedUntil: existing.claimedUntil,
        }
      }

      const claimId = nextClaimId(row, 'timer')
      const claimedUntil = Math.min(now + configuration.timerClaimTtlMs, currentLease.expiresAt)
      row.timers.set(normalized.timerId, {
        timerId: normalized.timerId,
        dueAt: normalized.dueAt,
        expected: copyVersion(normalized.expected),
        claimId,
        ownerFence: normalized.lease.fence,
        claimedUntil,
      })
      return {
        ok: true,
        claimId,
        timerId: normalized.timerId,
        dueAt: normalized.dueAt,
        expected: copyVersion(normalized.expected),
      }
    },

    async sweep(options) {
      const limit = readLimit(options)
      const now = readNow(configuration)
      let dedupeRemoved = 0
      let timerClaimsRemoved = 0

      for (const row of rows.values()) {
        for (const [key, entry] of row.dedupe) {
          if (dedupeRemoved + timerClaimsRemoved >= limit) break
          if (
            entry.status === 'completed' &&
            now - entry.completedAt >= configuration.completedDedupeMs
          ) {
            row.dedupe.delete(key)
            dedupeRemoved++
          }
        }
        for (const [key, entry] of row.timers) {
          if (dedupeRemoved + timerClaimsRemoved >= limit) break
          if (now - entry.claimedUntil >= configuration.timerClaimMs) {
            row.timers.delete(key)
            timerClaimsRemoved++
          }
        }
        if (dedupeRemoved + timerClaimsRemoved >= limit) break
      }

      return { dedupeRemoved, timerClaimsRemoved }
    },

    keys() {
      return Object.freeze(Array.from(rows.keys()).sort())
    },

    clear() {
      rows.clear()
    },
  }

  return store
}

function makeConfiguration(options: MemoryDurableStoreOptions): Configuration {
  const now = options.now ?? Date.now
  const leaseTtlMs = requirePositiveFinite(options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS, 'leaseTtlMs')
  const timerClaimTtlMs = requirePositiveFinite(
    options.timerClaimTtlMs ?? DEFAULT_TIMER_CLAIM_TTL_MS,
    'timerClaimTtlMs',
  )
  const retention = options.retention ?? {
    completedDedupeMs: DEFAULT_DEDUPE_RETENTION_MS,
    timerClaimMs: DEFAULT_TIMER_RETENTION_MS,
  }
  return {
    now,
    leaseTtlMs,
    timerClaimTtlMs,
    completedDedupeMs: requireNonNegativeFinite(
      retention.completedDedupeMs,
      'retention.completedDedupeMs',
    ),
    timerClaimMs: requireNonNegativeFinite(retention.timerClaimMs, 'retention.timerClaimMs'),
  }
}

function getOrCreateRow(rows: Map<string, Row>, key: string): Row {
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

function nextFence(row: Row): string {
  if (row.fenceCounter >= Number.MAX_SAFE_INTEGER) {
    throw new DurableStoreError('FENCE_EXHAUSTED', `fence counter exhausted for '${row.key}'`)
  }
  row.fenceCounter++
  return String(row.fenceCounter)
}

function nextClaimId(row: Row, kind: 'dedupe' | 'timer'): string {
  if (row.claimCounter >= Number.MAX_SAFE_INTEGER) {
    throw new DurableStoreError('FENCE_EXHAUSTED', `claim counter exhausted for '${row.key}'`)
  }
  row.claimCounter++
  return `${kind}:${row.claimCounter}`
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
  const limit = options?.limit ?? Number.POSITIVE_INFINITY
  if (limit !== Number.POSITIVE_INFINITY && (!Number.isInteger(limit) || limit < 0)) {
    throw new DurableStoreError(
      'INVALID_ARGUMENT',
      'retention limit must be a non-negative integer',
    )
  }
  return limit
}

function requireIdentifier(value: string, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DurableStoreError('INVALID_ARGUMENT', `${name} must be a non-empty string`)
  }
  return value
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

function requireFiniteNumber(value: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DurableStoreError('INVALID_ARGUMENT', `${name} must be a finite number`)
  }
  return value
}

function normalizeLease(value: Lease): Lease {
  if (typeof value !== 'object' || value === null) {
    throw new DurableStoreError('INVALID_ARGUMENT', 'lease must be an object')
  }
  const candidate = value as {
    key?: unknown
    ownerId?: unknown
    fence?: unknown
    expiresAt?: unknown
  }
  const key = requireIdentifier(candidate.key as string, 'lease.key')
  const ownerId = requireIdentifier(candidate.ownerId as string, 'lease.ownerId')
  const fence = requireIdentifier(candidate.fence as string, 'lease.fence')
  if (typeof candidate.expiresAt !== 'number' || !Number.isFinite(candidate.expiresAt)) {
    throw new DurableStoreError('INVALID_ARGUMENT', 'lease.expiresAt must be a finite number')
  }
  return { key, ownerId, fence, expiresAt: candidate.expiresAt }
}

function normalizeVersion(value: Version, name: string): Version {
  if (typeof value !== 'object' || value === null) {
    throw new DurableStoreError('INVALID_VERSION', `${name} must be an object`)
  }
  const candidate = value as { epoch?: unknown; seq?: unknown }
  if (
    typeof candidate.epoch !== 'number' ||
    !Number.isSafeInteger(candidate.epoch) ||
    candidate.epoch < 0 ||
    typeof candidate.seq !== 'number' ||
    !Number.isSafeInteger(candidate.seq) ||
    candidate.seq < 0
  ) {
    throw new DurableStoreError(
      'INVALID_VERSION',
      `${name} must contain non-negative safe integers`,
    )
  }
  return { epoch: candidate.epoch, seq: candidate.seq }
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
  const lease = normalizeLease(input.lease)
  const expected = input.expected === null ? null : normalizeVersion(input.expected, 'expected')
  const next = input.next === undefined ? undefined : normalizeRecord(input.next, 'next')
  const completeDedupe =
    input.completeDedupe === undefined ? undefined : normalizeDedupeCompletion(input.completeDedupe)
  const completeTimer =
    input.completeTimer === undefined ? undefined : normalizeTimerCompletion(input.completeTimer)
  if (next === undefined && completeDedupe === undefined && completeTimer === undefined) {
    throw new DurableStoreError('NOTHING_TO_COMMIT', 'commit needs a record or completion marker')
  }
  return { lease, expected, next, completeDedupe, completeTimer }
}

function normalizeRecord(value: DurableRecord, name: string): DurableRecord {
  if (typeof value !== 'object' || value === null) {
    throw new DurableStoreError('INVALID_ARGUMENT', `${name} must be an object`)
  }
  const candidate = value as { value?: unknown; version?: Version }
  if (!('value' in candidate)) {
    throw new DurableStoreError('INVALID_ARGUMENT', `${name}.value is required`)
  }
  if (candidate.version === undefined) {
    throw new DurableStoreError('INVALID_VERSION', `${name}.version is required`)
  }
  return { value: candidate.value, version: normalizeVersion(candidate.version, `${name}.version`) }
}

function normalizeDedupeClaimInput(input: DedupeClaimInput): DedupeClaimInput & {
  lease: Lease
} {
  if (typeof input !== 'object' || input === null) {
    throw new DurableStoreError('INVALID_ARGUMENT', 'dedupe claim input must be an object')
  }
  const lease = normalizeLease(input.lease)
  if (input.kind !== 'command' && input.kind !== 'event') {
    throw new DurableStoreError('INVALID_ARGUMENT', 'dedupe kind must be command or event')
  }
  const id = requireIdentifier(input.id, 'dedupe id')
  const digest = requireIdentifier(input.digest, 'dedupe digest')
  return { lease, kind: input.kind, id, digest, request: input.request }
}

function normalizeDedupeCompletion(input: DedupeCompletion): DedupeCompletion {
  if (typeof input !== 'object' || input === null) {
    throw new DurableStoreError('INVALID_ARGUMENT', 'dedupe completion must be an object')
  }
  if (input.kind !== 'command' && input.kind !== 'event') {
    throw new DurableStoreError('INVALID_ARGUMENT', 'dedupe kind must be command or event')
  }
  return {
    kind: input.kind,
    id: requireIdentifier(input.id, 'dedupe id'),
    digest: requireIdentifier(input.digest, 'dedupe digest'),
    claimId: requireIdentifier(input.claimId, 'dedupe claimId'),
    result: input.result,
  }
}

function normalizeTimerClaimInput(input: TimerClaimInput): TimerClaimInput & { lease: Lease } {
  if (typeof input !== 'object' || input === null) {
    throw new DurableStoreError('INVALID_ARGUMENT', 'timer claim input must be an object')
  }
  const lease = normalizeLease(input.lease)
  const timerId = requireIdentifier(input.timerId, 'timerId')
  const dueAt = requireFiniteNumber(input.dueAt, 'dueAt')
  return { lease, timerId, dueAt, expected: normalizeVersion(input.expected, 'expected') }
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

function isCurrentLease(row: Row, lease: Lease, now: number): boolean {
  const current = row.lease
  return (
    current !== undefined &&
    current.ownerId === lease.ownerId &&
    current.fence === lease.fence &&
    current.expiresAt > now
  )
}

function isCompletableDedupe(
  entry: InternalDedupe | undefined,
  completion: DedupeCompletion,
  fence: string,
): entry is PendingDedupe {
  return (
    entry?.status === 'pending' &&
    entry.digest === completion.digest &&
    entry.claimId === completion.claimId &&
    entry.ownerFence === fence
  )
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

function dedupeKey(kind: DedupeClaimInput['kind'], id: string): string {
  return `${kind}\u0000${id}`
}

function readRequest(request: unknown, existing: InternalDedupe | undefined): unknown {
  if (request !== undefined) return cloneValue(request, 'dedupe request')
  if (existing?.status === 'pending' && existing.request !== undefined) {
    return cloneValue(existing.request, 'dedupe request')
  }
  return undefined
}

function copyOptionalValue(value: unknown, name: string): unknown {
  return value === undefined ? undefined : cloneValue(value, name)
}

function cloneValue<Value>(value: Value, name: string): Value {
  let raw: string | undefined
  try {
    raw = JSON.stringify(value)
  } catch {
    throw new DurableStoreError('NOT_SERIALIZABLE', `${name} is not JSON-serializable`)
  }
  if (raw === undefined) {
    throw new DurableStoreError('NOT_SERIALIZABLE', `${name} is not JSON-serializable`)
  }
  const parsed: unknown = JSON.parse(raw)
  return parsed as Value
}

function copyVersion(version: Version): Version {
  return { epoch: version.epoch, seq: version.seq }
}

function copyNullableVersion(version: Version | null): Version | null {
  return version === null ? null : copyVersion(version)
}

function copyLease(lease: InternalLease): Lease {
  return {
    key: lease.key,
    ownerId: lease.ownerId,
    fence: lease.fence,
    expiresAt: lease.expiresAt,
  }
}

function copyRecord(record: DurableRecord, name = 'stored record'): DurableRecord {
  return {
    value: cloneValue(record.value, name),
    version: copyVersion(record.version),
  }
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

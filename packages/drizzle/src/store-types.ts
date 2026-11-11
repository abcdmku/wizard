import type {
  DedupeApplication,
  DedupeCompletion,
  DurableRecord,
  Lease,
  RetentionPolicy,
  TimerCompletion,
  Version,
} from '@openwizard/durable/store'

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
  dedupeId: string
  digest: string
  /** `applied` once a committed snapshot may contain the command's effects. */
  status: 'pending' | 'applied' | 'completed'
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

export interface SnapshotCommit {
  readonly lease: Lease
  readonly expected: Version | null
  readonly next: DurableRecord
  readonly now: number
  readonly snapshot: string
}

export interface FreshDedupeClaim {
  readonly lease: Lease
  readonly id: string
  readonly digest: string
  readonly expectedVersion: Version | undefined
  readonly now: number
  readonly request: string | null
}

export interface DedupeCompletionCommit {
  readonly lease: Lease
  readonly expected: Version | null
  readonly id: string
  readonly digest: string
  readonly claimId: string
  readonly now: number
  readonly result: string
}

export interface LockedRunRepository {
  readonly row: RunRow
  updateRun(patch: RunPatch): Promise<void>
  readDedupe(id: string): Promise<DedupeRow | null>
  insertDedupe(row: DedupeRow): Promise<void>
  updateDedupe(id: string, row: Partial<DedupeRow>): Promise<void>
  readTimer(timerId: string): Promise<TimerRow | null>
  putTimer(row: TimerRow): Promise<void>
  deleteTimer(timerId: string): Promise<void>
}

export interface DrizzleDurableRepository {
  readRun(key: string): Promise<RunRow | null>
  commitSnapshot?(input: SnapshotCommit): Promise<boolean>
  claimFreshDedupe?(input: FreshDedupeClaim): Promise<{ readonly claimId: string } | null>
  commitDedupeCompletion?(
    input: DedupeCompletionCommit,
  ): Promise<{ readonly version: Version | null } | null>
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

export interface Configuration {
  now: () => number
  leaseTtlMs: number
  timerClaimTtlMs: number
  completedDedupeMs: number
  timerClaimMs: number
}

export interface NormalizedCommitInput {
  lease: Lease
  expected: Version | null
  next: DurableRecord | undefined
  applyDedupe: DedupeApplication | undefined
  completeDedupe: DedupeCompletion | undefined
  completeTimers: readonly TimerCompletion[]
}

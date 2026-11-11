import { type CommitInput, type CommitResult, DurableStoreError } from '@openwizard/durable/store'
import {
  compareVersion,
  isCompletableDedupe,
  isCompletableTimer,
  isOpenClaim,
  normalizeCommitInput,
  readNow,
  type StoreConfiguration,
  sameVersion,
  serializeJson,
} from '@openwizard/store-kit'
import type { DrizzleDurableRepository, SnapshotCommit } from './store-types'
import { isCurrentLease, timerClaimView, versionFromRow } from './store-values'

export async function commit(
  repository: DrizzleDurableRepository,
  configuration: StoreConfiguration,
  input: CommitInput,
): Promise<CommitResult> {
  const normalized = normalizeCommitInput(input)
  const now = readNow(configuration)
  let snapshotError: DurableStoreError | null = null
  let dedupeResultError: DurableStoreError | null = null
  let fastDedupeResult: string | null = null
  if (
    normalized.next !== undefined &&
    normalized.applyDedupe === undefined &&
    normalized.completeDedupe === undefined &&
    normalized.completeTimers.length === 0 &&
    repository.commitSnapshot !== undefined
  ) {
    let snapshot: string | null = null
    try {
      snapshot = serializeJson(normalized.next.value, 'next record')
    } catch (error) {
      if (!(error instanceof DurableStoreError) || error.code !== 'NOT_SERIALIZABLE') throw error
      snapshotError = error
    }
    if (snapshot !== null) {
      const snapshotCommit: SnapshotCommit = {
        lease: normalized.lease,
        expected: normalized.expected,
        next: normalized.next,
        now,
        snapshot,
      }
      const committed = await repository.commitSnapshot(snapshotCommit)
      if (committed) return { ok: true, version: normalized.next.version }

      const failure = classifySnapshotFailure(
        await repository.readRun(normalized.lease.key),
        snapshotCommit,
      )
      if (failure !== null) return failure
    }
  }
  if (
    normalized.next === undefined &&
    normalized.completeDedupe !== undefined &&
    normalized.completeTimers.length === 0 &&
    repository.commitDedupeCompletion !== undefined
  ) {
    try {
      fastDedupeResult = serializeJson(normalized.completeDedupe.result, 'dedupe result')
    } catch (error) {
      if (!(error instanceof DurableStoreError) || error.code !== 'NOT_SERIALIZABLE') throw error
      dedupeResultError = error
    }
    if (fastDedupeResult !== null) {
      const committed = await repository.commitDedupeCompletion({
        lease: normalized.lease,
        expected: normalized.expected,
        id: normalized.completeDedupe.id,
        digest: normalized.completeDedupe.digest,
        claimId: normalized.completeDedupe.claimId,
        now,
        result: fastDedupeResult,
      })
      if (committed !== null) return { ok: true, version: committed.version }
    }
  }
  const result = await repository.withLockedRun<CommitResult>(
    normalized.lease.key,
    false,
    async (run) => {
      if (!isCurrentLease(run.row, normalized.lease, now)) {
        return { ok: false, code: 'LEASE_LOST' }
      }

      const actual = versionFromRow(run.row)
      if (!sameVersion(actual, normalized.expected)) {
        return { ok: false, code: 'CAS_CONFLICT', actual }
      }
      if (
        normalized.next !== undefined &&
        actual !== null &&
        compareVersion(normalized.next.version, actual) <= 0
      ) {
        return { ok: false, code: 'INVALID_VERSION' }
      }

      const applied = normalized.applyDedupe
      if (
        applied !== undefined &&
        !isOpenClaim(await run.readDedupe(applied.id), applied, normalized.lease.fence)
      ) {
        return { ok: false, code: 'DEDUPLICATE_CONFLICT' }
      }
      const dedupe =
        normalized.completeDedupe === undefined
          ? null
          : await run.readDedupe(normalized.completeDedupe.id)
      if (
        normalized.completeDedupe !== undefined &&
        !isCompletableDedupe(dedupe, normalized.completeDedupe, normalized.lease.fence)
      ) {
        return { ok: false, code: 'DEDUPLICATE_CONFLICT' }
      }

      for (const completion of normalized.completeTimers) {
        const timer = timerClaimView(await run.readTimer(completion.timerId))
        if (!isCompletableTimer(timer, completion, normalized.lease.fence)) {
          return { ok: false, code: 'TIMER_CLAIM_LOST' }
        }
      }

      if (snapshotError !== null) throw snapshotError
      if (dedupeResultError !== null) throw dedupeResultError
      const snapshot =
        normalized.next === undefined
          ? undefined
          : serializeJson(normalized.next.value, 'next record')
      const dedupeResult =
        normalized.completeDedupe === undefined
          ? undefined
          : (fastDedupeResult ?? serializeJson(normalized.completeDedupe.result, 'dedupe result'))

      if (normalized.next !== undefined && snapshot !== undefined) {
        await run.updateRun({
          snapshotEpoch: normalized.next.version.epoch,
          snapshotSeq: normalized.next.version.seq,
          snapshot,
        })
      }
      if (applied !== undefined) await run.updateDedupe(applied.id, { status: 'applied' })
      if (normalized.completeDedupe !== undefined && dedupeResult !== undefined) {
        await run.updateDedupe(normalized.completeDedupe.id, {
          status: 'completed',
          result: dedupeResult,
          completedAt: now,
        })
      }
      for (const completion of normalized.completeTimers) await run.deleteTimer(completion.timerId)

      return { ok: true, version: normalized.next?.version ?? actual }
    },
  )
  return result.found ? result.value : { ok: false, code: 'LEASE_LOST' }
}

function classifySnapshotFailure(
  row: Awaited<ReturnType<DrizzleDurableRepository['readRun']>>,
  input: SnapshotCommit,
): CommitResult | null {
  if (row === null || !isCurrentLease(row, input.lease, input.now)) {
    return { ok: false, code: 'LEASE_LOST' }
  }
  const actual = versionFromRow(row)
  if (!sameVersion(actual, input.expected)) {
    return { ok: false, code: 'CAS_CONFLICT', actual }
  }
  if (actual !== null && compareVersion(input.next.version, actual) <= 0) {
    return { ok: false, code: 'INVALID_VERSION' }
  }
  return null
}

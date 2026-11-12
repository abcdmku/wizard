import {
  type DedupeClaimInput,
  type DedupeClaimResult,
  DurableStoreError,
  type TimerClaimInput,
  type TimerClaimResult,
} from '@openwizard/durable/store'
import {
  nextCounter,
  normalizeDedupeClaimInput,
  normalizeTimerClaimInput,
  readNow,
  type StoreConfiguration,
  sameVersion,
  serializeJson,
} from '@openwizard/store-kit'
import type { DedupeRow, DrizzleDurableRepository } from './store-types'
import { isCurrentLease, parseJson, parseOptionalJson, versionFromRow } from './store-values'

export async function claimDedupe(
  repository: DrizzleDurableRepository,
  configuration: StoreConfiguration,
  input: DedupeClaimInput,
): Promise<DedupeClaimResult> {
  const normalized = normalizeDedupeClaimInput(input)
  const now = readNow(configuration)
  let requestError: DurableStoreError | null = null
  let freshRequest: string | null = null
  if (repository.claimFreshDedupe !== undefined) {
    try {
      freshRequest = readDedupeRequest(normalized.request, null)
    } catch (error) {
      if (!(error instanceof DurableStoreError) || error.code !== 'NOT_SERIALIZABLE') throw error
      requestError = error
    }
    if (requestError === null) {
      const claimed = await repository.claimFreshDedupe({
        lease: normalized.lease,
        id: normalized.id,
        digest: normalized.digest,
        expectedVersion: normalized.expectedVersion,
        now,
        request: freshRequest,
      })
      if (claimed !== null) {
        const request = parseOptionalJson(freshRequest, 'dedupe request')
        return {
          ok: true,
          status: 'claimed',
          claimId: claimed.claimId,
          ...(request === undefined ? {} : { request }),
        }
      }
    }
  }
  const result = await repository.withLockedRun<DedupeClaimResult>(
    normalized.lease.key,
    false,
    async (run) => {
      if (!isCurrentLease(run.row, normalized.lease, now)) {
        return { ok: false, code: 'LEASE_LOST' }
      }

      const existing = await run.readDedupe(normalized.id)
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
          result: parseJson(existing.result, 'dedupe result'),
        }
      }
      if (existing !== null && existing.digest !== normalized.digest) {
        return {
          ok: false,
          code: 'DEDUPLICATE_CONFLICT',
          existingDigest: existing.digest,
        }
      }
      if (existing !== null && existing.ownerFence === normalized.lease.fence) {
        const request = parseOptionalJson(existing.request, 'dedupe request')
        return {
          ok: true,
          status: 'pending',
          claimId: existing.claimId,
          ownerFence: existing.ownerFence,
          claimedAt: existing.claimedAt,
          ...(request === undefined ? {} : { request }),
        }
      }
      if (existing?.status === 'applied') return { ok: true, status: 'applied' }

      const actual = versionFromRow(run.row)
      if (
        normalized.expectedVersion !== undefined &&
        !sameVersion(actual, normalized.expectedVersion)
      ) {
        return { ok: false, code: 'CAS_CONFLICT', actual }
      }

      const claimCounter = nextCounter(run.row.claimCounter, run.row.key, 'claim')
      const claimId = `dedupe:${claimCounter}`
      let request: string | null
      if (repository.claimFreshDedupe === undefined) {
        request = readDedupeRequest(normalized.request, existing)
      } else {
        if (requestError !== null) throw requestError
        request = normalized.request === undefined ? (existing?.request ?? null) : freshRequest
      }
      await run.updateRun({ claimCounter })
      const row: DedupeRow = {
        runKey: run.row.key,
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
      else await run.updateDedupe(normalized.id, row)
      const requestResult = parseOptionalJson(request, 'dedupe request')
      return {
        ok: true,
        status: 'claimed',
        claimId,
        ...(requestResult === undefined ? {} : { request: requestResult }),
      }
    },
  )
  return result.found ? result.value : { ok: false, code: 'LEASE_LOST' }
}

export async function claimTimer(
  repository: DrizzleDurableRepository,
  configuration: StoreConfiguration,
  input: TimerClaimInput,
): Promise<TimerClaimResult> {
  const normalized = normalizeTimerClaimInput(input)
  const now = readNow(configuration)
  const result = await repository.withLockedRun<TimerClaimResult>(
    normalized.lease.key,
    false,
    async (run) => {
      if (!isCurrentLease(run.row, normalized.lease, now)) {
        return { ok: false, code: 'LEASE_LOST' }
      }

      const actual = versionFromRow(run.row)
      if (!sameVersion(actual, normalized.expected)) {
        return { ok: false, code: 'TIMER_STALE', actual }
      }
      if (now < normalized.dueAt) {
        return { ok: false, code: 'TIMER_NOT_DUE', dueAt: normalized.dueAt }
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
          ok: false,
          code: 'TIMER_ALREADY_CLAIMED',
          claimId: existing.claimId,
          ownerFence: existing.ownerFence,
          claimedUntil: existing.claimedUntil,
        }
      }

      const claimCounter = nextCounter(run.row.claimCounter, run.row.key, 'claim')
      const claimId = `timer:${claimCounter}`
      const claimedUntil = Math.min(now + configuration.timerClaimTtlMs, normalized.lease.expiresAt)
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
        ok: true,
        claimId,
        timerId: normalized.timerId,
        dueAt: normalized.dueAt,
        expected: normalized.expected,
      }
    },
  )
  return result.found ? result.value : { ok: false, code: 'LEASE_LOST' }
}

function readDedupeRequest(request: unknown, existing: DedupeRow | null): string | null {
  if (request === undefined) return existing?.request ?? null
  return serializeJson(request, 'dedupe request')
}

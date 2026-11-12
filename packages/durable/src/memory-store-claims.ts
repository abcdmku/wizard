import type { DurableStore } from '@openwizard/durable/store'
import {
  isCurrentLease,
  normalizeDedupeClaimInput,
  normalizeTimerClaimInput,
  readLimit,
  readNow,
  sameVersion,
} from '@openwizard/store-kit'
import {
  copyNullableVersion,
  copyOptionalValue,
  copyVersion,
  type MemoryStoreState,
  nextClaimId,
  type OpenDedupe,
  readRequest,
} from './memory-store-internals'

type ClaimOperations = Pick<DurableStore, 'claimDedupe' | 'claimTimer' | 'sweep'>

export function createMemoryClaimOperations(state: MemoryStoreState): ClaimOperations {
  return {
    async claimDedupe(input) {
      const normalized = normalizeDedupeClaimInput(input)
      const now = readNow(state.configuration)
      const row = state.rows.get(normalized.lease.key)
      if (row === undefined || !isCurrentLease(row.lease, normalized.lease, now)) {
        return { ok: false, code: 'LEASE_LOST' }
      }

      const existing = row.dedupe.get(normalized.id)
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
          result: copyOptionalValue(existing.result, 'dedupe result'),
        }
      }

      if (existing !== undefined && existing.digest !== normalized.digest) {
        return {
          ok: false,
          code: 'DEDUPLICATE_CONFLICT',
          existingDigest: existing.digest,
        }
      }

      if (existing !== undefined && existing.ownerFence === normalized.lease.fence) {
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
      if (existing?.status === 'applied') return { ok: true, status: 'applied' }

      const actual = row.record?.version ?? null
      if (
        normalized.expectedVersion !== undefined &&
        !sameVersion(actual, normalized.expectedVersion)
      ) {
        return { ok: false, code: 'CAS_CONFLICT', actual: copyNullableVersion(actual) }
      }

      const claimId = nextClaimId(row, 'dedupe')
      const request = readRequest(normalized.request, existing)
      const pending: OpenDedupe = {
        status: 'pending',
        digest: normalized.digest,
        claimId,
        ownerFence: normalized.lease.fence,
        claimedAt: now,
        ...(request === undefined ? {} : { request }),
      }
      row.dedupe.set(normalized.id, pending)
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
      const now = readNow(state.configuration)
      const row = state.rows.get(normalized.lease.key)
      const currentLease = row?.lease
      if (
        row === undefined ||
        currentLease === undefined ||
        !isCurrentLease(currentLease, normalized.lease, now)
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
      const claimedUntil = Math.min(
        now + state.configuration.timerClaimTtlMs,
        currentLease.expiresAt,
      )
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
      const now = readNow(state.configuration)
      let dedupeRemoved = 0
      let timerClaimsRemoved = 0

      for (const row of state.rows.values()) {
        for (const [key, entry] of row.dedupe) {
          if (dedupeRemoved + timerClaimsRemoved >= limit) break
          if (
            entry.status === 'completed' &&
            now - entry.completedAt >= state.configuration.completedDedupeMs
          ) {
            row.dedupe.delete(key)
            dedupeRemoved++
          }
        }
        for (const [key, entry] of row.timers) {
          if (dedupeRemoved + timerClaimsRemoved >= limit) break
          if (now - entry.claimedUntil >= state.configuration.timerClaimMs) {
            row.timers.delete(key)
            timerClaimsRemoved++
          }
        }
        if (dedupeRemoved + timerClaimsRemoved >= limit) break
      }

      return { dedupeRemoved, timerClaimsRemoved }
    },
  }
}

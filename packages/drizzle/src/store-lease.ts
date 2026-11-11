import type {
  AcquireLeaseResult,
  DurableRecord,
  Lease,
  LeaseOptions,
  ReleaseLeaseResult,
  RenewLeaseResult,
} from '@openwizard/durable/store'
import { DurableStoreError } from '@openwizard/durable/store'
import { readNow, readTtl } from './store-configuration'
import { normalizeLease, requireIdentifier } from './store-input'
import type { Configuration, DrizzleDurableRepository } from './store-types'
import { hasLiveLease, isCurrentLease, nextCounter, recordFromRow } from './store-values'

export async function acquireLease(
  repository: DrizzleDurableRepository,
  configuration: Configuration,
  key: string,
  ownerId: string,
  leaseOptions: LeaseOptions | undefined,
): Promise<AcquireLeaseResult> {
  const checkedKey = requireIdentifier(key, 'key')
  const checkedOwnerId = requireIdentifier(ownerId, 'ownerId')
  const ttlMs = readTtl(leaseOptions, configuration.leaseTtlMs)
  const now = readNow(configuration)

  const result = await repository.withLockedRun<AcquireLeaseResult>(
    checkedKey,
    true,
    async (run) => {
      if (hasLiveLease(run.row, now)) {
        return { ok: false, code: 'LEASE_BUSY', retryAt: run.row.leaseExpiresAt }
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
        ok: true,
        lease: { key: checkedKey, ownerId: checkedOwnerId, fence, expiresAt },
        record: recordFromRow(run.row),
      }
    },
  )

  if (!result.found) {
    throw new DurableStoreError('INVALID_ARGUMENT', 'the adapter could not create its run row')
  }
  return result.value
}

export async function readRecord(
  repository: DrizzleDurableRepository,
  key: string,
): Promise<DurableRecord | null> {
  const row = await repository.readRun(requireIdentifier(key, 'key'))
  return row === null ? null : recordFromRow(row)
}

export async function renewLease(
  repository: DrizzleDurableRepository,
  configuration: Configuration,
  lease: Lease,
  leaseOptions: LeaseOptions | undefined,
): Promise<RenewLeaseResult> {
  const checkedLease = normalizeLease(lease)
  const ttlMs = readTtl(leaseOptions, configuration.leaseTtlMs)
  const now = readNow(configuration)
  const result = await repository.withLockedRun<RenewLeaseResult>(
    checkedLease.key,
    false,
    async (run) => {
      if (!isCurrentLease(run.row, checkedLease, now)) {
        return { ok: false, code: 'LEASE_LOST' }
      }
      const expiresAt = now + ttlMs
      await run.updateRun({ leaseExpiresAt: expiresAt })
      return { ok: true, lease: { ...checkedLease, expiresAt } }
    },
  )
  return result.found ? result.value : { ok: false, code: 'LEASE_LOST' }
}

export async function releaseLease(
  repository: DrizzleDurableRepository,
  configuration: Configuration,
  lease: Lease,
): Promise<ReleaseLeaseResult> {
  const checkedLease = normalizeLease(lease)
  const now = readNow(configuration)
  const result = await repository.withLockedRun<ReleaseLeaseResult>(
    checkedLease.key,
    false,
    async (run) => {
      if (!isCurrentLease(run.row, checkedLease, now)) {
        return { ok: false, code: 'LEASE_LOST' }
      }
      await run.updateRun({ ownerId: null, fence: null, leaseExpiresAt: null })
      return { ok: true }
    },
  )
  return result.found ? result.value : { ok: false, code: 'LEASE_LOST' }
}

import type { DurableStore } from '@openwizard/durable/store'
import { claimDedupe, claimTimer } from './store-claims'
import { commit } from './store-commit'
import { makeConfiguration, readLimit, readNow } from './store-configuration'
import { acquireLease, readRecord, releaseLease, renewLease } from './store-lease'
import type { DrizzleDurableRepository, DrizzleDurableStoreOptions } from './store-types'

export type {
  DedupeRow,
  DrizzleDurableRepository,
  DrizzleDurableStoreOptions,
  LockedRunRepository,
  RunPatch,
  RunRow,
  TimerRow,
} from './store-types'

export function createDrizzleDurableStore(
  repository: DrizzleDurableRepository,
  options: DrizzleDurableStoreOptions = {},
): DurableStore {
  const configuration = makeConfiguration(options)

  return {
    leaseTtlMs: configuration.leaseTtlMs,
    acquire(key, ownerId, leaseOptions) {
      return acquireLease(repository, configuration, key, ownerId, leaseOptions)
    },
    read(key) {
      return readRecord(repository, key)
    },
    renew(lease, leaseOptions) {
      return renewLease(repository, configuration, lease, leaseOptions)
    },
    release(lease) {
      return releaseLease(repository, configuration, lease)
    },
    commit(input) {
      return commit(repository, configuration, input)
    },
    claimDedupe(input) {
      return claimDedupe(repository, configuration, input)
    },
    claimTimer(input) {
      return claimTimer(repository, configuration, input)
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

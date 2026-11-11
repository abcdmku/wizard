import type { DurableStore, Lease, Version } from '@openwizard/durable/store'
import { expect } from 'vitest'

/** What each conformance case group gets from `durableStoreContract`. */
export interface ConformanceContext {
  store(): DurableStore
  advance(milliseconds: number): void
}

export const version0: Version = { epoch: 0, seq: 0 }
export const version1: Version = { epoch: 0, seq: 1 }
export const version2: Version = { epoch: 0, seq: 2 }

export async function acquire(
  store: DurableStore,
  key: string,
  ownerId = 'owner-a',
): Promise<Lease> {
  const acquired = await store.acquire(key, ownerId)
  if (!acquired.ok) throw new Error(`expected to acquire '${key}', got ${acquired.code}`)
  return acquired.lease
}

/** Commit a record at `version` and assert it succeeded. */
export async function commitVersion(
  store: DurableStore,
  lease: Lease,
  expected: Version | null,
  version: Version,
): Promise<void> {
  expect(
    await store.commit({ lease, expected, next: { value: { seq: version.seq }, version } }),
  ).toEqual({ ok: true, version })
}

/** Claim a new command id and return its claim id. */
export async function claimNew(
  store: DurableStore,
  lease: Lease,
  id: string,
  digest: string,
  expectedVersion?: Version,
): Promise<string> {
  const claim = await store.claimDedupe({
    lease,
    id,
    digest,
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
  })
  if (!claim.ok || claim.status !== 'claimed') {
    throw new Error(`expected a new claim for '${id}', got ${JSON.stringify(claim)}`)
  }
  return claim.claimId
}

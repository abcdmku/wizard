import type { DurableRecord, Lease, Version } from '@openwizard/durable/store'
import {
  makeStoreConfiguration,
  nextCounter,
  type StoreConfiguration,
  serializeJson,
} from '@openwizard/store-kit'
import type { MemoryDurableStoreOptions } from './memory-store'

interface InternalLease {
  key: string
  ownerId: string
  fence: string
  expiresAt: number
}

/** A claim not completed yet; `applied` once a committed snapshot may contain its effects. */
export interface OpenDedupe {
  status: 'pending' | 'applied'
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

export type InternalDedupe = OpenDedupe | CompletedDedupe

export interface TimerClaim {
  timerId: string
  dueAt: number
  expected: Version
  claimId: string
  ownerFence: string
  claimedUntil: number
}

export interface Row {
  key: string
  fenceCounter: number
  claimCounter: number
  lease: InternalLease | undefined
  record?: DurableRecord
  dedupe: Map<string, InternalDedupe>
  timers: Map<string, TimerClaim>
}

export interface MemoryStoreState {
  readonly configuration: StoreConfiguration
  readonly rows: Map<string, Row>
}

export function createMemoryStoreState(options: MemoryDurableStoreOptions): MemoryStoreState {
  return { configuration: makeStoreConfiguration(options), rows: new Map() }
}

export function getOrCreateRow(rows: Map<string, Row>, key: string): Row {
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

export function nextFence(row: Row): string {
  row.fenceCounter = nextCounter(row.fenceCounter, row.key, 'fence')
  return String(row.fenceCounter)
}

export function nextClaimId(row: Row, kind: 'dedupe' | 'timer'): string {
  row.claimCounter = nextCounter(row.claimCounter, row.key, 'claim')
  return `${kind}:${row.claimCounter}`
}

export function readRequest(request: unknown, existing: InternalDedupe | undefined): unknown {
  if (request !== undefined) return cloneValue(request, 'dedupe request')
  if (existing?.status === 'pending' && existing.request !== undefined) {
    return cloneValue(existing.request, 'dedupe request')
  }
  return undefined
}

export function copyOptionalValue(value: unknown, name: string): unknown {
  return value === undefined ? undefined : cloneValue(value, name)
}

export function cloneValue<Value>(value: Value, name: string): Value {
  return JSON.parse(serializeJson(value, name))
}

export function copyVersion(version: Version): Version {
  return { epoch: version.epoch, seq: version.seq }
}

export function copyNullableVersion(version: Version | null): Version | null {
  return version === null ? null : copyVersion(version)
}

export function copyLease(lease: InternalLease): Lease {
  return {
    key: lease.key,
    ownerId: lease.ownerId,
    fence: lease.fence,
    expiresAt: lease.expiresAt,
  }
}

export function copyRecord(record: DurableRecord, name = 'stored record'): DurableRecord {
  return {
    value: cloneValue(record.value, name),
    version: copyVersion(record.version),
  }
}

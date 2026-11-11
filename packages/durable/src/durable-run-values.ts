import type { Scheduler } from '@openwizard/core'
import { DurableStoreError, type Lease, type Version } from '@openwizard/durable/store'
import type { DurableHostFailure, DurableRunFailureCode } from './durable-run'
import type { CommitFailureCode, DurableLeaseLossCode } from './durable-run-state'

export function positive(value: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new DurableStoreError(
      'INVALID_ARGUMENT',
      `${name} must be a finite number greater than 0`,
    )
  }
  return value
}

export function sameVersion(left: Version | null, right: Version | null): boolean {
  return (
    (left === null && right === null) ||
    (left !== null && right !== null && left.epoch === right.epoch && left.seq === right.seq)
  )
}

export function copyVersion(version: Version): Version {
  return { epoch: version.epoch, seq: version.seq }
}

export function copyLease(lease: Lease): Lease {
  return { ...lease }
}

export function digestOf(value: unknown): string {
  return `json:${stableJson(value, new Set())}`
}

function stableJson(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value !== 'object') {
    throw new DurableStoreError('NOT_SERIALIZABLE', 'digest input is not JSON-serializable')
  }
  if (seen.has(value)) throw new DurableStoreError('NOT_SERIALIZABLE', 'digest input is circular')
  seen.add(value)
  let result: string
  if (Array.isArray(value)) {
    result = `[${value.map((entry) => stableJson(entry, seen)).join(',')}]`
  } else {
    if (!isStringRecord(value)) {
      throw new DurableStoreError('NOT_SERIALIZABLE', 'digest input is not a plain object')
    }
    result = `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key], seen)}`)
      .join(',')}}`
  }
  seen.delete(value)
  return result
}

function isStringRecord(value: object): value is Record<string, unknown> {
  return !Array.isArray(value)
}

export function commitFailureCode(code: CommitFailureCode): DurableLeaseLossCode {
  if (code === 'TIMER_CLAIM_LOST') return 'TIMER_CLAIM_LOST'
  if (code === 'CAS_CONFLICT' || code === 'INVALID_VERSION') return 'CAS_CONFLICT'
  return 'LEASE_LOST'
}

const FAILURE_MESSAGES: Readonly<Record<DurableRunFailureCode, string>> = {
  LEASE_LOST: 'this host no longer owns the run lease; reopen the run and retry',
  CAS_CONFLICT: 'the run is not at the expected version; read the current version and retry',
  DEDUPLICATE_CONFLICT: 'this command id was already used for a different command',
  COMMAND_PENDING: 'a command with this id is still being applied by this owner',
  COMMAND_INTERRUPTED:
    'the owner that ran this command stopped before recording its result; read the run state instead of retrying this id',
}

export function hostFailure(
  code: DurableRunFailureCode,
  details: { readonly actual?: Version | null; readonly claimId?: string } = {},
): DurableHostFailure {
  return { ok: false, code, message: FAILURE_MESSAGES[code], ...details }
}

export function dedupeFailureCode(code: CommitFailureCode): DurableRunFailureCode {
  if (code === 'DEDUPLICATE_CONFLICT') return 'DEDUPLICATE_CONFLICT'
  if (code === 'CAS_CONFLICT' || code === 'INVALID_VERSION') return 'CAS_CONFLICT'
  return 'LEASE_LOST'
}

interface NativeTimerHandle {
  readonly timer: ReturnType<typeof setTimeout>
}

function isNativeTimerHandle(value: unknown): value is NativeTimerHandle {
  return typeof value === 'object' && value !== null && 'timer' in value
}

export const nativeScheduler: Scheduler = {
  setTimeout(fn, ms) {
    return { timer: setTimeout(fn, ms) }
  },
  clearTimeout(handle) {
    if (isNativeTimerHandle(handle)) clearTimeout(handle.timer)
  },
}

import type { AnyWizard, CommandResult } from '@openwizard/core'
import type { DedupeClaimResult, DurableStore, Version } from '@openwizard/durable/store'
import type { DurableHostFailure } from './durable-run'
import type { HostState } from './durable-run-state'
import { copyVersion, dedupeFailureCode, hostFailure } from './durable-run-values'

const STORED_RESULT_FORMAT = 'openwizard.durable.command-result/v1'

interface StoredCommandResult {
  readonly format: typeof STORED_RESULT_FORMAT
  readonly result: CommandResult
  readonly version: Version
}

export function storedCommandResult(result: CommandResult, version: Version): StoredCommandResult {
  return { format: STORED_RESULT_FORMAT, result, version: copyVersion(version) }
}

type ClaimOutcome =
  | { readonly kind: 'claimed'; readonly claimId: string }
  | { readonly kind: 'replayed'; readonly result: CommandResult; readonly version: Version }
  | { readonly kind: 'failure'; readonly value: DurableHostFailure }

/** Store a command result next to its claim, fenced by the current lease and persisted version. */
export async function completeDedupe<F extends AnyWizard>(
  state: Pick<
    HostState<F>,
    'store' | 'getLease' | 'getPersistedVersion' | 'getVersion' | 'enqueueBarrier' | 'markLost'
  >,
  completion: {
    readonly id: string
    readonly digest: string
    readonly claimId: string
    readonly result: CommandResult
  },
): Promise<{ readonly ok: true; readonly version: Version } | DurableHostFailure> {
  return state.enqueueBarrier(async () => {
    const version = copyVersion(state.getVersion())
    const stored = storedCommandResult(completion.result, version)
    let committed: Awaited<ReturnType<DurableStore['commit']>>
    try {
      committed = await state.store.commit({
        lease: state.getLease(),
        expected: state.getPersistedVersion(),
        completeDedupe: { ...completion, result: stored },
      })
    } catch {
      state.markLost('LEASE_LOST')
      return hostFailure('LEASE_LOST')
    }
    if (!committed.ok) {
      if (committed.code === 'LEASE_LOST') state.markLost('LEASE_LOST')
      else if (committed.code === 'CAS_CONFLICT') state.markLost('CAS_CONFLICT')
      return hostFailure(
        dedupeFailureCode(committed.code),
        committed.code === 'CAS_CONFLICT' ? { actual: committed.actual } : {},
      )
    }
    return { ok: true, version }
  })
}

/** Map a store claim to what the host does next: apply, replay, or fail. */
export function claimForCommand(claim: DedupeClaimResult): ClaimOutcome {
  if (!claim.ok) {
    if (claim.code === 'CAS_CONFLICT') {
      return { kind: 'failure', value: hostFailure('CAS_CONFLICT', { actual: claim.actual }) }
    }
    return { kind: 'failure', value: hostFailure(claim.code) }
  }
  if (claim.status === 'completed') {
    const stored = readStoredResult(claim.result)
    return stored === undefined
      ? { kind: 'failure', value: hostFailure('DEDUPLICATE_CONFLICT') }
      : { kind: 'replayed', result: stored.result, version: copyVersion(stored.version) }
  }
  if (claim.status === 'applied') {
    return { kind: 'failure', value: hostFailure('COMMAND_INTERRUPTED') }
  }
  if (claim.status === 'pending') {
    return {
      kind: 'failure',
      value: hostFailure('COMMAND_PENDING', { claimId: claim.claimId }),
    }
  }
  return { kind: 'claimed', claimId: claim.claimId }
}

function readStoredResult(value: unknown): StoredCommandResult | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('format' in value) ||
    value.format !== STORED_RESULT_FORMAT ||
    !('result' in value) ||
    !isCommandResult(value.result) ||
    !('version' in value) ||
    !isVersion(value.version)
  ) {
    return undefined
  }
  return { format: STORED_RESULT_FORMAT, result: value.result, version: value.version }
}

function isVersion(value: unknown): value is Version {
  return (
    typeof value === 'object' &&
    value !== null &&
    'epoch' in value &&
    typeof value.epoch === 'number' &&
    Number.isSafeInteger(value.epoch) &&
    'seq' in value &&
    typeof value.seq === 'number' &&
    Number.isSafeInteger(value.seq)
  )
}

function isCommandResult(value: unknown): value is CommandResult {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return false
  if (value.ok === true) return 'seq' in value && typeof value.seq === 'number'
  return (
    value.ok === false &&
    'code' in value &&
    typeof value.code === 'string' &&
    'message' in value &&
    typeof value.message === 'string'
  )
}

import type { DurableRunHost } from '@openwizard/durable'
import type { DurableStore, Version } from '@openwizard/durable/store'
import type { CommandFailureCode, DomainResult, PlayerCommand } from './domain.js'
import {
  commandResultKey,
  type DungeonFlowContext,
  type dungeonFlow,
  type RecentCommandReceipt,
} from './flow.js'
import { authorizePlayerCommand } from './server.js'

const RECEIPT_FORMAT = 'openwizard.dungeon.command-receipt/v1'

interface StoredCommandReceipt {
  readonly format: typeof RECEIPT_FORMAT
  readonly digest: string
  readonly result: DomainResult
}

interface ExecuteCommandReceiptOptions {
  readonly store: DurableStore
  readonly host: DurableRunHost<typeof dungeonFlow>
  readonly playerId: string
  readonly commandId: string
  readonly expectedVersion?: Version
  readonly command: PlayerCommand
  readonly settle: () => Promise<void>
}

export interface CommandReceiptOutcome {
  readonly result: DomainResult
  readonly replayed: boolean
  readonly repairRequired?: true
}

const failure = (code: CommandFailureCode, message: string): DomainResult => ({
  ok: false,
  code,
  message,
})

const isFailureCode = (value: unknown): value is CommandFailureCode =>
  value === 'INVALID_COMMAND' ||
  value === 'FORBIDDEN' ||
  value === 'NOT_FOUND' ||
  value === 'OUT_OF_RANGE' ||
  value === 'STALE' ||
  value === 'BUSY' ||
  value === 'INTERNAL' ||
  value === 'KEY_NOT_OWNED' ||
  value === 'DOOR_ALREADY_OPEN'

const isDomainResult = (value: unknown): value is DomainResult => {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return false
  if (value.ok === true) return true
  return (
    value.ok === false &&
    'code' in value &&
    isFailureCode(value.code) &&
    'message' in value &&
    typeof value.message === 'string'
  )
}

const readStoredReceipt = (value: unknown): StoredCommandReceipt | undefined => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('format' in value) ||
    value.format !== RECEIPT_FORMAT ||
    !('digest' in value) ||
    typeof value.digest !== 'string' ||
    !('result' in value) ||
    !isDomainResult(value.result)
  ) {
    return undefined
  }
  return { format: RECEIPT_FORMAT, digest: value.digest, result: value.result }
}

const sameResult = (left: DomainResult, right: DomainResult): boolean => {
  if (left.ok || right.ok) return left.ok === right.ok
  return left.code === right.code && left.message === right.message
}

const part = (value: string): string => `${value.length}:${value}`

export const commandDigest = (playerId: string, command: PlayerCommand): string => {
  const prefix = `dungeon-command/v1|${part(playerId)}|${part(command.type)}`
  switch (command.type) {
    case 'ready':
      return `${prefix}|${command.ready ? '1' : '0'}`
    case 'move':
      return `${prefix}|${part(command.direction)}`
    case 'attack':
      return `${prefix}|${command.targetId === undefined ? '0:' : part(command.targetId)}`
    case 'interact':
      return `${prefix}|${part(command.targetId)}`
    case 'pickup':
      return `${prefix}|${part(command.lootId)}`
    case 'item-use':
      return `${prefix}|${command.slot}`
    case 'rematch':
      return prefix
  }
}

const receiptId = (key: string): string => `dungeon-command:${key}`
const contextOf = (host: DurableRunHost<typeof dungeonFlow>): DungeonFlowContext =>
  host.run.getState().context

const isSettled = (host: DurableRunHost<typeof dungeonFlow>): boolean => {
  const snapshot = host.run.getSnapshot()
  return snapshot.epoch === host.version.epoch && snapshot.seq === host.version.seq
}

const hasCoherentActiveWait = (host: DurableRunHost<typeof dungeonFlow>): boolean => {
  const state = host.run.getState()
  if (state.status !== 'waiting' || state.nav.phase !== 'idle' || state.active.length !== 1) {
    return false
  }
  const active = state.active[0]
  if (active === undefined || active !== state.context.world.phase) return false
  const step = state.steps[active]
  return (
    step.kind === 'step' &&
    step.status === 'active' &&
    host.run
      .waitingFor()
      .some((wait) => wait.path.length === 0 && wait.kind === 'event' && wait.step === active)
  )
}

const recentFor = (
  host: DurableRunHost<typeof dungeonFlow>,
  key: string,
): RecentCommandReceipt | undefined => {
  const recent = contextOf(host).lastCommandReceipt
  return recent?.key === key ? recent : undefined
}

const storedValue = (receipt: RecentCommandReceipt): StoredCommandReceipt => ({
  format: RECEIPT_FORMAT,
  digest: receipt.digest,
  result: receipt.result,
})

const completeReceipt = async (
  store: DurableStore,
  host: DurableRunHost<typeof dungeonFlow>,
  receipt: RecentCommandReceipt,
  claimId: string,
): Promise<boolean> => {
  try {
    const completed = await store.commit({
      lease: host.lease,
      expected: host.version,
      completeDedupe: {
        id: receiptId(receipt.key),
        digest: receipt.digest,
        claimId,
        result: storedValue(receipt),
      },
    })
    return completed.ok
  } catch {
    return false
  }
}

const claimFailure = (code: 'LEASE_LOST' | 'CAS_CONFLICT' | 'DEDUPLICATE_CONFLICT') => {
  if (code === 'CAS_CONFLICT') return failure('STALE', 'party state changed')
  if (code === 'DEDUPLICATE_CONFLICT') {
    return failure('INVALID_COMMAND', 'commandId was already used for another command')
  }
  return failure('INTERNAL', 'durable party host lost ownership')
}

export async function executeCommandReceipt(
  options: ExecuteCommandReceiptOptions,
): Promise<CommandReceiptOutcome> {
  const key = commandResultKey(options.playerId, options.commandId)
  const digest = commandDigest(options.playerId, options.command)
  const recent = recentFor(options.host, key)
  if (recent !== undefined && !isSettled(options.host)) {
    return { result: claimFailure('LEASE_LOST'), replayed: false }
  }
  if (recent !== undefined && recent.digest !== digest) {
    return { result: claimFailure('DEDUPLICATE_CONFLICT'), replayed: false }
  }

  let claim: Awaited<ReturnType<DurableStore['claimDedupe']>>
  try {
    claim = await options.store.claimDedupe({
      lease: options.host.lease,
      id: receiptId(key),
      digest,
      ...(options.expectedVersion === undefined
        ? {}
        : { expectedVersion: options.expectedVersion }),
      request: {
        playerId: options.playerId,
        commandId: options.commandId,
        command: options.command,
      },
    })
  } catch {
    return { result: claimFailure('LEASE_LOST'), replayed: false }
  }
  if (!claim.ok) return { result: claimFailure(claim.code), replayed: false }
  if (claim.status === 'completed') {
    const stored = readStoredReceipt(claim.result)
    return stored === undefined || stored.digest !== digest
      ? { result: failure('INTERNAL', 'durable command receipt is invalid'), replayed: false }
      : { result: stored.result, replayed: true }
  }
  if (claim.status === 'applied') {
    // An older fence already changed the snapshot. The missing completion is
    // ambiguous, so close admission instead of applying the command again.
    return {
      result: failure('INTERNAL', 'command receipt was applied by another owner'),
      replayed: false,
      repairRequired: true,
    }
  }

  if (recent !== undefined) {
    const completed = await completeReceipt(options.store, options.host, recent, claim.claimId)
    return completed
      ? { result: recent.result, replayed: true }
      : { result: claimFailure('LEASE_LOST'), replayed: false, repairRequired: true }
  }

  const authorized = authorizePlayerCommand(
    contextOf(options.host).world,
    options.playerId,
    options.command,
  )
  if (!authorized.ok) {
    const receipt = { key, digest, result: authorized }
    const completed = await completeReceipt(options.store, options.host, receipt, claim.claimId)
    return completed
      ? { result: authorized, replayed: false }
      : { result: claimFailure('LEASE_LOST'), replayed: false }
  }

  try {
    const sent = await options.host.run.send('player.command', {
      commandId: options.commandId,
      digest,
      playerId: options.playerId,
      command: options.command,
    })
    if (!sent.ok)
      return { result: failure('INTERNAL', 'command event was rejected'), replayed: false }
    await options.settle()
  } catch {
    return { result: claimFailure('LEASE_LOST'), replayed: false }
  }
  const applied = recentFor(options.host, key)
  if (applied === undefined || applied.digest !== digest) {
    return {
      result: failure('INTERNAL', 'command completed without a domain result'),
      replayed: false,
    }
  }
  const completed = await completeReceipt(options.store, options.host, applied, claim.claimId)
  return completed
    ? { result: applied.result, replayed: false }
    : { result: claimFailure('LEASE_LOST'), replayed: false, repairRequired: true }
}

export async function repairLastCommandReceipt(
  store: DurableStore,
  host: DurableRunHost<typeof dungeonFlow>,
): Promise<boolean> {
  if (!isSettled(host) || !hasCoherentActiveWait(host)) return false
  const recent = contextOf(host).lastCommandReceipt
  if (recent === undefined) return true
  let claim: Awaited<ReturnType<DurableStore['claimDedupe']>>
  try {
    claim = await store.claimDedupe({
      lease: host.lease,
      id: receiptId(recent.key),
      digest: recent.digest,
      expectedVersion: host.version,
    })
  } catch {
    return false
  }
  if (!claim.ok) return false
  if (claim.status === 'applied') return false
  if (claim.status !== 'completed') {
    return completeReceipt(store, host, recent, claim.claimId)
  }
  const stored = readStoredReceipt(claim.result)
  return (
    stored !== undefined &&
    stored.digest === recent.digest &&
    sameResult(stored.result, recent.result)
  )
}

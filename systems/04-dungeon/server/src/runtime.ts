import { randomUUID } from 'node:crypto'
import type { Clock, Scheduler } from '@openwizard/core'
import { createDurableRun, type DurableRunHost, resumeDurableRun } from '@openwizard/durable'
import type { DurableStore } from '@openwizard/durable/store'
import { executeCommandReceipt, repairLastCommandReceipt } from './command-receipts.js'
import type {
  CommandFailureCode,
  DomainResult,
  PlayerCommand,
  SeedPlayer,
  Viewer,
  WorldState,
} from './domain.js'
import { createInitialWorld } from './generate.js'
import { type DungeonWizardContext, dungeonWizard, migrateDungeonSnapshot } from './wizard.js'

export interface RuntimeCommand {
  readonly commandId: string
  readonly expectedSequence?: number
  readonly command: PlayerCommand
}
export interface RuntimeAck {
  readonly result: DomainResult
  readonly replayed: boolean
  readonly sequence: number
  readonly tick: number
}
export interface RuntimeOptions {
  readonly partyId: string
  readonly store: DurableStore
  readonly ownerId: string
  readonly scheduler?: Scheduler
  readonly clock?: Clock
  readonly leaseTtlMs?: number
  readonly onLeaseLost?: () => void
}
export interface CreateRuntimeOptions extends RuntimeOptions {
  readonly seed: number
  readonly players: readonly SeedPlayer[]
}

export type RuntimeOpenResult =
  | { readonly ok: true; readonly runtime: PartyRuntime }
  | { readonly ok: false; readonly code: 'BUSY'; readonly retryAt: number }
  | { readonly ok: false; readonly code: 'NOT_FOUND' | 'LEASE_LOST' }

export interface PartyRuntime {
  readonly partyId: string
  readonly runKey: string
  readonly host: DurableRunHost<typeof dungeonWizard>
  state(): WorldState
  sequence(): number
  hasLivePlayers(): boolean
  onUnavailable(listener: () => void): () => void
  command(viewer: Viewer, input: RuntimeCommand): Promise<RuntimeAck>
  tick(): Promise<RuntimeAck>
  connect(playerId: string): Promise<void>
  disconnect(playerId: string): Promise<void>
  reset(seed: number, commandId?: string): Promise<void>
  dispose(): Promise<void>
}

const contextOf = (host: DurableRunHost<typeof dungeonWizard>): DungeonWizardContext =>
  host.run.getState().context

const failure = (code: CommandFailureCode, message: string): DomainResult => ({
  ok: false,
  code,
  message,
})

const currentAck = (
  host: DurableRunHost<typeof dungeonWizard>,
  result: DomainResult,
  replayed: boolean,
  world: WorldState,
): RuntimeAck => ({
  result,
  replayed,
  sequence: host.version.seq,
  tick: world.tick,
})

const expectedVersion = (
  host: DurableRunHost<typeof dungeonWizard>,
  expectedSequence: number | undefined,
) =>
  expectedSequence === undefined ? undefined : { epoch: host.version.epoch, seq: expectedSequence }

const makeRuntime = (
  partyId: string,
  store: DurableStore,
  host: DurableRunHost<typeof dungeonWizard>,
  invalidate: (() => void) | undefined,
): PartyRuntime => {
  const runKey = `party:${partyId}`
  const livePlayers = new Set<string>()
  const unavailableListeners = new Set<() => void>()
  let acceptingMutations = true
  let operation = Promise.resolve()
  let disposal: Promise<void> | undefined
  let visibleWorld = contextOf(host).world
  const callUnavailable = (listener: () => void): void => {
    try {
      listener()
    } catch {
      // Unavailability listeners are isolated from each other.
    }
  }
  const notifyUnavailable = (): void => {
    if (!acceptingMutations) return
    acceptingMutations = false
    for (const listener of unavailableListeners) callUnavailable(listener)
    unavailableListeners.clear()
  }
  const subscribeUnavailable = (listener: () => void): (() => void) => {
    if (!acceptingMutations) callUnavailable(listener)
    else unavailableListeners.add(listener)
    return () => unavailableListeners.delete(listener)
  }
  const enqueue = <Result>(work: () => Promise<Result>): Promise<Result> => {
    const next = operation.then(work, work)
    operation = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }
  const mutate = <Result>(work: () => Promise<Result>): Promise<Result> =>
    acceptingMutations
      ? enqueue(() =>
          acceptingMutations ? work() : Promise.reject(new Error('party runtime is disposed')),
        )
      : Promise.reject(new Error('party runtime is disposed'))
  const acknowledge = (result: DomainResult, replayed: boolean): RuntimeAck =>
    currentAck(host, result, replayed, visibleWorld)
  const settle = async (): Promise<void> => {
    await host.run.whenIdle()
    const snapshot = host.run.getSnapshot()
    const version = host.version
    if (snapshot.epoch !== version.epoch || snapshot.seq !== version.seq) {
      throw new Error('durable party did not settle at its persisted version')
    }
    visibleWorld = contextOf(host).world
  }
  const sendPresence = async (
    event: 'player.connected' | 'player.disconnected',
    playerId: string,
  ) => {
    const sent = await host.send(event, { playerId }, { eventId: `presence:${randomUUID()}` })
    if (sent.ok) await settle()
  }
  const dispose = (): Promise<void> => {
    if (disposal !== undefined) return disposal
    notifyUnavailable()
    disposal = enqueue(async () => {
      livePlayers.clear()
      await host.dispose()
    })
    return disposal
  }
  return {
    partyId,
    runKey,
    host,
    state: () => visibleWorld,
    sequence: () => host.version.seq,
    hasLivePlayers: () => acceptingMutations && livePlayers.size > 0,
    onUnavailable: subscribeUnavailable,
    command: (viewer, input) =>
      mutate(async () => {
        if (viewer.partyId !== partyId) {
          return acknowledge(failure('FORBIDDEN', 'viewer belongs to another party'), false)
        }
        if (contextOf(host).world.players[viewer.playerId] === undefined) {
          return acknowledge(failure('FORBIDDEN', 'player is not in this party'), false)
        }
        const expected = expectedVersion(host, input.expectedSequence)
        const receipt = await executeCommandReceipt({
          store,
          host,
          playerId: viewer.playerId,
          commandId: input.commandId,
          command: input.command,
          settle,
          ...(expected === undefined ? {} : { expectedVersion: expected }),
        })
        if (receipt.repairRequired === true) {
          notifyUnavailable()
          try {
            invalidate?.()
          } catch {
            // The local gate stays closed even if an invalidation observer throws.
          }
        }
        return acknowledge(receipt.result, receipt.replayed)
      }),
    tick: () =>
      mutate(async () => {
        if (livePlayers.size === 0) return acknowledge({ ok: true }, false)
        const sequence = host.version.seq
        const tick = contextOf(host).world.tick
        try {
          const sent = await host.run.send('world.tick', {})
          if (sent.ok) await settle()
          if (sent.ok) return acknowledge({ ok: true }, false)
        } catch {
          // The durable barrier stops the run before an unpersisted tick can be acknowledged.
        }
        return {
          result: failure('INTERNAL', 'durable party host lost ownership'),
          replayed: false,
          sequence,
          tick,
        }
      }),
    connect: (playerId) =>
      mutate(async () => {
        await sendPresence('player.connected', playerId)
        livePlayers.add(playerId)
      }),
    disconnect: (playerId) =>
      mutate(async () => {
        livePlayers.delete(playerId)
        await sendPresence('player.disconnected', playerId)
      }),
    reset: (seed, commandId = randomUUID()) =>
      mutate(async () => {
        const sent = await host.send('admin.reset', { seed }, { eventId: `reset:${commandId}` })
        if (sent.ok) await settle()
      }),
    dispose,
  }
}

const finishOpen = async (
  partyId: string,
  store: DurableStore,
  onUnavailable: (() => void) | undefined,
  opened: Awaited<ReturnType<typeof createDurableRun<typeof dungeonWizard>>>,
): Promise<RuntimeOpenResult> => {
  if (!opened.ok) {
    if (opened.code === 'LEASE_BUSY') return { ok: false, code: 'BUSY', retryAt: opened.retryAt }
    return { ok: false, code: opened.code === 'RUN_NOT_FOUND' ? 'NOT_FOUND' : opened.code }
  }
  if (opened.host.run.getState().status === 'idle') {
    const started = await opened.host.dispatch({ type: 'start' }, { commandId: 'system:start' })
    if (!started.ok) {
      await opened.host.dispose()
      return { ok: false, code: 'LEASE_LOST' }
    }
  }
  if (!(await repairLastCommandReceipt(store, opened.host))) {
    await opened.host.dispose()
    return { ok: false, code: 'LEASE_LOST' }
  }
  return { ok: true, runtime: makeRuntime(partyId, store, opened.host, onUnavailable) }
}

const hostOptions = (options: RuntimeOptions) => ({
  store: options.store,
  key: `party:${options.partyId}`,
  ownerId: `${options.ownerId}:${options.partyId}`,
  lease: { ttlMs: options.leaseTtlMs ?? 5_000 },
  renew: { everyMs: Math.max(100, Math.floor((options.leaseTtlMs ?? 5_000) / 3)) },
  ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
  ...(options.clock === undefined ? {} : { clock: options.clock }),
  ...(options.onLeaseLost === undefined ? {} : { onLeaseLost: options.onLeaseLost }),
})

export const createPartyRuntime = async (
  options: CreateRuntimeOptions,
): Promise<RuntimeOpenResult> =>
  finishOpen(
    options.partyId,
    options.store,
    options.onLeaseLost,
    await createDurableRun(dungeonWizard, {
      ...hostOptions(options),
      context: {
        world: createInitialWorld(options.partyId, options.seed, options.players),
      },
      instanceId: `party:${options.partyId}`,
    }),
  )

export const resumePartyRuntime = async (options: RuntimeOptions): Promise<RuntimeOpenResult> =>
  finishOpen(
    options.partyId,
    options.store,
    options.onLeaseLost,
    await resumeDurableRun(dungeonWizard, {
      ...hostOptions(options),
      migrate: migrateDungeonSnapshot,
    }),
  )

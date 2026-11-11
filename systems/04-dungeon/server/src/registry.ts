import type { Clock, Scheduler } from '@openwizard/core'
import { createHostRegistry, type HostOpenContext, type HostOpenResult } from '@openwizard/durable'
import type { DurableStore } from '@openwizard/durable/store'
import type { PartyDirectory } from './directory.js'
import type { SeedPlayer } from './domain.js'
import {
  createPartyRuntime,
  type PartyRuntime,
  type RuntimeOpenResult,
  resumePartyRuntime,
} from './runtime.js'

export type RegistryTimerHandle = ReturnType<typeof setTimeout>

export interface RegistryScheduler {
  setInterval(callback: () => void, delayMs: number): RegistryTimerHandle
  clearInterval(handle: RegistryTimerHandle): void
  setTimeout(callback: () => void, delayMs: number): RegistryTimerHandle
  clearTimeout(handle: RegistryTimerHandle): void
}

const nativeScheduler: RegistryScheduler = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
}

export interface PartyRegistryOptions {
  readonly store: DurableStore
  readonly directory: PartyDirectory
  readonly ownerId: string
  readonly scheduler?: RegistryScheduler
  readonly wizardScheduler?: Scheduler
  readonly clock?: Clock
  readonly leaseTtlMs?: number
  readonly onError?: (error: unknown) => void
}

export interface SeedPartyInput {
  readonly partyId: string
  readonly seed: number
  readonly players: readonly SeedPlayer[]
}

export interface RegistryTickStats {
  readonly pulses: number
  readonly admitted: number
  readonly completed: number
  readonly dropped: number
}

export interface PartyRegistry {
  start(): Promise<readonly RuntimeOpenResult[]>
  seed(input: SeedPartyInput): Promise<RuntimeOpenResult>
  get(partyId: string): Promise<RuntimeOpenResult>
  cached(partyId: string): PartyRuntime | undefined
  listCached(): readonly PartyRuntime[]
  tickAll(): Promise<void>
  tickStats(partyId: string): RegistryTickStats
  stop(): Promise<void>
}

type RuntimeOpenFailure = Exclude<RuntimeOpenResult, { readonly ok: true }>
type PartyOpenIdentity =
  | { readonly mode: 'resume'; readonly partyId: string }
  | {
      readonly mode: 'seed'
      readonly partyId: string
      readonly seed: number
      readonly players: readonly SeedPlayer[]
    }

export const createPartyRegistry = (options: PartyRegistryOptions): PartyRegistry => {
  const scheduler = options.scheduler ?? nativeScheduler
  const retries = new Map<string, RegistryTimerHandle>()
  const phaseTimers = new Map<
    string,
    { readonly runtime: PartyRuntime; readonly handle: RegistryTimerHandle }
  >()
  const outstandingTicks = new Map<PartyRuntime, number>()
  const tickStats = new Map<string, RegistryTickStats>()
  let interval: RegistryTimerHandle | undefined

  const report = (error: unknown): void => {
    try {
      options.onError?.(error)
    } catch {
      // Error reporting must not stop the party supervisor.
    }
  }

  const runtimeOptions = (partyId: string, context: HostOpenContext) => ({
    partyId,
    store: options.store,
    ownerId: options.ownerId,
    ...(options.wizardScheduler === undefined ? {} : { scheduler: options.wizardScheduler }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.leaseTtlMs === undefined ? {} : { leaseTtlMs: options.leaseTtlMs }),
    onLeaseLost: context.invalidate,
  })

  const openRuntime = async (
    identity: PartyOpenIdentity,
    context: HostOpenContext,
  ): Promise<HostOpenResult<PartyRuntime, RuntimeOpenFailure>> => {
    const common = runtimeOptions(identity.partyId, context)
    const opened =
      identity.mode === 'seed'
        ? await createPartyRuntime({
            ...common,
            seed: identity.seed,
            players: identity.players,
          })
        : await resumePartyRuntime(common)
    return opened.ok ? { ok: true, value: opened.runtime } : opened
  }

  const hosts = createHostRegistry({
    key: (identity: PartyOpenIdentity) => identity.partyId,
    open: openRuntime,
    close: (runtime: PartyRuntime) => runtime.dispose(),
  })

  const asRuntimeResult = (opened: Awaited<ReturnType<typeof hosts.open>>): RuntimeOpenResult => {
    if (opened.ok) return { ok: true, runtime: opened.value }
    return opened.code === 'HOST_REGISTRY_DISPOSED' ? { ok: false, code: 'LEASE_LOST' } : opened
  }

  const lazyOpen = async (partyId: string): Promise<RuntimeOpenResult> =>
    asRuntimeResult(await hosts.open({ mode: 'resume', partyId }))

  const scheduleBusyRetry = (partyId: string, retryAt: number): void => {
    const existing = retries.get(partyId)
    if (existing !== undefined) scheduler.clearTimeout(existing)
    const delay = Math.max(1, retryAt - (options.clock?.now() ?? Date.now()))
    const handle = scheduler.setTimeout(() => {
      retries.delete(partyId)
      void lazyOpen(partyId).then((opened) => {
        if (!opened.ok && opened.code === 'BUSY') scheduleBusyRetry(partyId, opened.retryAt)
      }, report)
    }, delay)
    retries.set(partyId, handle)
  }

  const statsFor = (partyId: string): RegistryTickStats =>
    tickStats.get(partyId) ?? { pulses: 0, admitted: 0, completed: 0, dropped: 0 }

  const updateStats = (partyId: string, patch: Partial<RegistryTickStats>): void => {
    tickStats.set(partyId, { ...statsFor(partyId), ...patch })
  }

  const finishTick = (runtime: PartyRuntime, completed: boolean): void => {
    if (completed) {
      const stats = statsFor(runtime.partyId)
      updateStats(runtime.partyId, { completed: stats.completed + 1 })
    }
    const remaining = (outstandingTicks.get(runtime) ?? 1) - 1
    if (remaining <= 0) outstandingTicks.delete(runtime)
    else outstandingTicks.set(runtime, remaining)
  }

  const tickOne = (runtime: PartyRuntime): Promise<void> => {
    const stats = statsFor(runtime.partyId)
    updateStats(runtime.partyId, { pulses: stats.pulses + 1 })
    if (!runtime.hasLivePlayers()) return Promise.resolve()
    const outstanding = outstandingTicks.get(runtime) ?? 0
    if (outstanding >= 2) {
      updateStats(runtime.partyId, { dropped: statsFor(runtime.partyId).dropped + 1 })
      return Promise.resolve()
    }
    outstandingTicks.set(runtime, outstanding + 1)
    updateStats(runtime.partyId, { admitted: statsFor(runtime.partyId).admitted + 1 })
    let ticking: ReturnType<PartyRuntime['tick']>
    try {
      ticking = runtime.tick()
    } catch (error) {
      finishTick(runtime, false)
      return Promise.reject(error)
    }
    return ticking.then(
      (ack) => finishTick(runtime, ack.result.ok),
      (error: unknown) => {
        finishTick(runtime, false)
        return Promise.reject(error)
      },
    )
  }

  const clearPhaseTimers = (): void => {
    for (const phase of phaseTimers.values()) scheduler.clearTimeout(phase.handle)
    phaseTimers.clear()
  }

  const pulseBackgroundCycle = (): void => {
    const runtimes = registry.listCached().filter((runtime) => runtime.hasLivePlayers())
    const live = new Map(runtimes.map((runtime) => [runtime.partyId, runtime]))
    for (const [partyId, phase] of phaseTimers) {
      if (live.get(partyId) === phase.runtime) continue
      scheduler.clearTimeout(phase.handle)
      phaseTimers.delete(partyId)
    }
    for (let index = 0; index < runtimes.length; index += 1) {
      const runtime = runtimes[index]
      if (runtime === undefined || phaseTimers.has(runtime.partyId)) continue
      let handle: RegistryTimerHandle | undefined
      const pulse = (): void => {
        const phase = phaseTimers.get(runtime.partyId)
        if (handle === undefined || phase?.handle !== handle) return
        phaseTimers.delete(runtime.partyId)
        if (registry.cached(runtime.partyId) !== runtime || !runtime.hasLivePlayers()) return
        void tickOne(runtime).catch(report)
      }
      handle = scheduler.setTimeout(pulse, Math.floor((index * 100) / runtimes.length))
      phaseTimers.set(runtime.partyId, { runtime, handle })
    }
  }

  const registry: PartyRegistry = {
    async start() {
      const parties = await options.directory.list()
      const opened = await Promise.all(parties.map((party) => lazyOpen(party.partyId)))
      for (let index = 0; index < parties.length; index += 1) {
        const result = opened[index]
        const party = parties[index]
        if (result !== undefined && party !== undefined && !result.ok && result.code === 'BUSY') {
          scheduleBusyRetry(party.partyId, result.retryAt)
        }
      }
      if (interval === undefined) {
        interval = scheduler.setInterval(pulseBackgroundCycle, 100)
        pulseBackgroundCycle()
      }
      return opened
    },
    async seed(input) {
      const identity: PartyOpenIdentity = { mode: 'seed', ...input }
      const opened = asRuntimeResult(await hosts.open(identity))
      if (opened.ok) {
        try {
          await options.directory.register({
            partyId: input.partyId,
            runKey: opened.runtime.runKey,
          })
        } catch (error) {
          await hosts.evict(identity, opened.runtime)
          throw error
        }
      }
      return opened
    },
    get: lazyOpen,
    cached: (partyId) => hosts.cached({ mode: 'resume', partyId }),
    listCached: () => [...hosts.values()].sort((a, b) => a.partyId.localeCompare(b.partyId)),
    async tickAll() {
      await Promise.all(registry.listCached().map((runtime) => tickOne(runtime)))
    },
    tickStats: (partyId) => ({ ...statsFor(partyId) }),
    async stop() {
      if (interval !== undefined) scheduler.clearInterval(interval)
      interval = undefined
      clearPhaseTimers()
      for (const handle of retries.values()) scheduler.clearTimeout(handle)
      retries.clear()
      try {
        await hosts.dispose()
      } finally {
        outstandingTicks.clear()
      }
    },
  }
  return registry
}

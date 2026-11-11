import type {
  AnyWizard,
  Command,
  ContextInput,
  DepsOf,
  EventType,
  PayloadInput,
  RequiredDepsOf,
  RunOptions,
} from '@openwizard/core'
import type { ReleaseLeaseResult, RenewLeaseResult } from '@openwizard/durable/store'
import {
  createDurableRun,
  type DurableCommandOptions,
  type DurableCommandResult,
  type DurableEventOptions,
  type DurableEventResult,
  type DurableResumeOptions,
  type DurableRunHost,
  type DurableRunOpenFailure,
  resumeDurableRun,
} from './durable-run'
import type { DurableLeaseLossCode } from './durable-run-state'
import { hostFailure, nativeScheduler } from './durable-run-values'
import { createHostRegistry, type HostRegistryDisposed } from './host-registry'

type HostDeps<F extends AnyWizard> =
  {} extends RequiredDepsOf<F>
    ? { readonly deps?: (key: string) => Partial<DepsOf<F>> }
    : { readonly deps: (key: string) => RequiredDepsOf<F> & Partial<DepsOf<F>> }

/**
 * Options of `createDurableHost`: the run options every run shares (scheduler, clock, `redact`,
 * `eventIds`, `migrate`, lease and renewal), plus `deps(key)` for dependencies still required
 * after `wizard.provide()`.
 *
 * @public
 */
export type DurableHostOptions<F extends AnyWizard> = Omit<
  DurableResumeOptions<F>,
  'key' | 'ownerId' | 'onLeaseLost' | 'deps'
> & {
  /** Written on every lease this host takes. Default: a random id per host. */
  readonly ownerId?: string
  /** A run's host stopped on its own (lease, CAS, or timer claim lost). The key reopens on use. */
  readonly onLeaseLost?: (key: string, code: DurableLeaseLossCode) => void
} & HostDeps<F>

/** Per-run creation options of `DurableHost.create`. @public */
export type DurableCreateOptions<F extends AnyWizard> = Pick<
  RunOptions<F>,
  'instanceId' | 'correlationId'
>

/** Why `DurableHost` could not reach a run: open failures plus a disposed host. @public */
export type DurableHostOpenFailure = DurableRunOpenFailure | HostRegistryDisposed

/**
 * Result of `DurableHost.open` / `create`. A returned handle's `send` and `dispatch` reopen
 * its key after automatic lease release. Its `run` belongs to the latest generation that
 * handle used; local run commands and subscriptions last only as long as that lease.
 *
 * @public
 */
export type DurableHostOpenResult<F extends AnyWizard> =
  | { readonly ok: true; readonly host: DurableRunHost<F> }
  | DurableHostOpenFailure

/**
 * Durable runs of one wizard, addressed by key. The host owns each run's lease (renewal, release on
 * a terminal result, reopening after a takeover) and keeps live runs open in memory; every method
 * returns failures as values.
 *
 * @public
 */
export interface DurableHost<F extends AnyWizard> {
  /** Create the run at `key` (or resume the one stored there) and keep it open. */
  create(
    key: string,
    input: ContextInput<F>,
    options?: DurableCreateOptions<F>,
  ): Promise<DurableHostOpenResult<F>>
  /** The open run at `key`, resuming it from the store when needed (`RUN_NOT_FOUND` if none). */
  open(key: string): Promise<DurableHostOpenResult<F>>
  /** `open(key)`, then `send` through its host: a redelivered `eventId` is a duplicate. */
  send<E extends EventType<F>, P>(
    key: string,
    event: E,
    payload: unknown extends P ? P : PayloadInput<F, E>,
    options: DurableEventOptions,
  ): Promise<DurableEventResult | DurableHostOpenFailure>
  /** `open(key)`, then `dispatch` through its host: a repeated `commandId` replays its result. */
  dispatch(
    key: string,
    command: Command<F>,
    options: DurableCommandOptions,
  ): Promise<DurableCommandResult | DurableHostOpenFailure>
  /** Release every lease once in-flight commands and events commit. Later calls fail. */
  dispose(): Promise<void>
}

/** What the registry opens: a key, plus the creation input when the run may not exist yet. */
interface OpenRequest {
  readonly key: string
  readonly create?: {
    readonly input: ContextInput<AnyWizard>
    readonly options?: DurableCreateOptions<AnyWizard>
  }
}

/**
 * Host the durable runs of `wizard` on `store`: what a multi-worker service would otherwise build
 * from `createHostRegistry` and `createDurableRun`. A run whose lease is lost is dropped and
 * reopened by the next call for its key. A terminal run releases its lease after in-flight host
 * operations settle. Returned handles can be held across I/O: `send` and `dispatch` reopen on
 * demand and replay persisted ids. A competing owner makes a held handle return `LEASE_LOST`;
 * `open(key)` reports `LEASE_BUSY` with its retry time. Explicitly released handles stay closed.
 *
 * @public
 */
export function createDurableHost<F extends AnyWizard>(
  wizard: F,
  options: DurableHostOptions<F>,
): DurableHost<F>
export function createDurableHost(wizard: AnyWizard, options: unknown): unknown {
  // The public overload keeps callbacks typed to the concrete wizard. This implementation
  // erases those arguments while every run it creates still belongs to that same wizard.
  const {
    ownerId = crypto.randomUUID(),
    onLeaseLost,
    deps,
    ...shared
  } = options as DurableHostOptions<AnyWizard>
  const scheduler = shared.scheduler ?? nativeScheduler
  // A key's previous lease must be released before the same owner can take it again.
  const releasing = new Map<string, Promise<void>>()
  const active = new Map<string, number>()
  const releaseTimers = new Map<DurableRunHost<AnyWizard>, unknown>()
  const handles = new WeakMap<DurableRunHost<AnyWizard>, DurableRunHost<AnyWizard>>()

  const releaseIfTerminal = (key: string, host: DurableRunHost<AnyWizard>): void => {
    if (host.run.result() === undefined || releaseTimers.has(host)) return
    const timer = scheduler.setTimeout(() => {
      releaseTimers.delete(host)
      if ((active.get(key) ?? 0) > 0 || host.run.result() === undefined) return
      void registry.evict({ key }, host).catch(() => undefined)
    }, 0)
    releaseTimers.set(host, timer)
  }

  const registry = createHostRegistry<
    OpenRequest,
    DurableRunHost<AnyWizard>,
    DurableRunOpenFailure
  >({
    key: (request) => request.key,
    async open({ key, create }, context) {
      await releasing.get(key)
      const runOptions = {
        ...shared,
        ...(deps === undefined ? {} : { deps: deps(key) }),
        key,
        ownerId,
        onLeaseLost: (code: DurableLeaseLossCode) => {
          context.invalidate()
          onLeaseLost?.(key, code)
        },
      }
      const opened =
        create === undefined
          ? await resumeDurableRun(wizard, runOptions)
          : await createDurableRun(wizard, {
              ...runOptions,
              ...create.options,
              context: create.input,
            })
      if (!opened.ok) return opened
      opened.host.run.subscribeResult(() => releaseIfTerminal(key, opened.host))
      releaseIfTerminal(key, opened.host)
      return { ok: true, value: opened.host }
    },
    close(host) {
      const key = host.lease.key
      if (releaseTimers.has(host)) {
        scheduler.clearTimeout(releaseTimers.get(host))
        releaseTimers.delete(host)
      }
      const released = host.dispose()
      const settled = released.then(
        () => undefined,
        () => undefined,
      )
      releasing.set(key, settled)
      void settled.then(() => {
        if (releasing.get(key) === settled) releasing.delete(key)
      })
      return released
    },
  })

  const withHost = async <Result>(
    key: string,
    work: (host: DurableRunHost<AnyWizard>) => Promise<Result>,
    unavailable: (failure: DurableHostOpenFailure) => Result,
  ): Promise<Result> => {
    // Reserve before awaiting open: a terminal-release timer cannot close this operation's host.
    active.set(key, (active.get(key) ?? 0) + 1)
    try {
      const opened = await registry.open({ key })
      return opened.ok ? await work(opened.value) : unavailable(opened)
    } finally {
      const remaining = (active.get(key) ?? 1) - 1
      if (remaining === 0) active.delete(key)
      else active.set(key, remaining)
      const cached = registry.cached({ key })
      if (cached !== undefined) releaseIfTerminal(key, cached)
    }
  }

  const handleFor = (host: DurableRunHost<AnyWizard>): DurableRunHost<AnyWizard> => {
    const cached = handles.get(host)
    if (cached !== undefined) return cached
    const key = host.lease.key
    let current = host
    let closed = false
    const pending = new Set<Promise<unknown>>()
    const operate = <Result>(
      work: (opened: DurableRunHost<AnyWizard>) => Promise<Result>,
      unavailable: () => Result,
    ): Promise<Result> => {
      const operation = withHost<Result>(
        key,
        (opened) => {
          current = opened
          return work(opened)
        },
        unavailable,
      )
      pending.add(operation)
      void operation.then(
        () => pending.delete(operation),
        () => pending.delete(operation),
      )
      return operation
    }
    const release = async (): Promise<ReleaseLeaseResult> => {
      if (closed) return { ok: false, code: 'LEASE_LOST' }
      closed = true
      await Promise.allSettled(pending)
      const released = current.release()
      await registry.evict({ key }, current)
      return released
    }
    const handle: DurableRunHost<AnyWizard> = {
      get run() {
        return current.run
      },
      get lease() {
        return current.lease
      },
      get version() {
        return current.version
      },
      renew(renewOptions) {
        if (closed) return Promise.resolve({ ok: false, code: 'LEASE_LOST' })
        return operate<RenewLeaseResult>(
          (opened) => opened.renew(renewOptions),
          () => ({ ok: false, code: 'LEASE_LOST' }),
        )
      },
      dispatch(command, commandOptions) {
        if (closed) return Promise.resolve(hostFailure('LEASE_LOST'))
        return operate<DurableCommandResult>(
          (opened) => opened.dispatch(command, commandOptions),
          () => hostFailure('LEASE_LOST'),
        )
      },
      send(event, payload, eventOptions) {
        if (closed) return Promise.resolve(hostFailure('LEASE_LOST'))
        return operate<DurableEventResult>(
          (opened) => opened.send<typeof event, unknown>(event, payload, eventOptions),
          () => hostFailure('LEASE_LOST'),
        )
      },
      release,
      async dispose() {
        await release()
      },
    }
    handles.set(host, handle)
    return handle
  }

  const open = async (request: OpenRequest): Promise<DurableHostOpenResult<AnyWizard>> => {
    const opened = await registry.open(request)
    return opened.ok ? { ok: true, host: handleFor(opened.value) } : opened
  }

  const durable: DurableHost<AnyWizard> = {
    async create(key, input, createOptions) {
      const request = {
        key,
        create: { input, ...(createOptions === undefined ? {} : { options: createOptions }) },
      }
      const opened = await open(request)
      // A concurrent `open(key)` was already resuming and found nothing: create now.
      return !opened.ok && opened.code === 'RUN_NOT_FOUND' ? open(request) : opened
    },
    open: (key) => open({ key }),
    send(key, event, payload, eventOptions) {
      return withHost<DurableEventResult | DurableHostOpenFailure>(
        key,
        (host) => host.send<typeof event, unknown>(event, payload, eventOptions),
        (failure) => failure,
      )
    },
    dispatch(key, command, commandOptions) {
      return withHost<DurableCommandResult | DurableHostOpenFailure>(
        key,
        (host) => host.dispatch(command, commandOptions),
        (failure) => failure,
      )
    },
    dispose: () => registry.dispose(),
  }
  return durable
}

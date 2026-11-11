import type { AnyWizard, RunResult } from '@openwizard/core'
import { createHostRegistry, type DurableRunHost, type HostOpenContext } from '@openwizard/durable'
import {
  type DeliveryRunIdentity,
  type DeliveryRuntimeHostFailureCode,
  type DeliveryRuntimeOpenDependencies,
  DeliveryRuntimeOpener,
  type DeliveryRuntimeOpenMode,
  DeliveryRuntimeRegistryError,
  deliveryRunKey,
  recoverDeliveryRuntimes,
} from './runtime-open.js'

export {
  type DeliveryHostOptions,
  type DeliveryRunIdentity,
  type DeliveryRuntimeErrorCode,
  type DeliveryRuntimeHostFailureCode,
  DeliveryRuntimeRegistryError,
  deliveryRunKey,
} from './runtime-open.js'

export interface DeliveryRunRepository {
  listActiveRuns(): Promise<readonly DeliveryRunIdentity[]>
  hasDelivery(tenantId: string, deliveryId: string): Promise<boolean>
}

export type DeliveryDurableCommands<F extends AnyWizard> = Pick<
  DurableRunHost<F>,
  'dispatch' | 'send' | 'version'
>

type Awaitable<T> = T | PromiseLike<T>

export interface DeliveryRuntimeRegistryOptions<
  F extends AnyWizard,
  Signal,
  Intervention,
  Viewer,
  SignalResult,
  InterventionResult,
> extends DeliveryRuntimeOpenDependencies<F> {
  readonly repository: DeliveryRunRepository
  readonly initialize?: (host: DurableRunHost<F>, identity: DeliveryRunIdentity) => Awaitable<void>
  readonly signal: (
    host: DeliveryDurableCommands<F>,
    identity: DeliveryRunIdentity,
    signal: Signal,
  ) => Awaitable<SignalResult>
  readonly intervene: (
    host: DeliveryDurableCommands<F>,
    identity: DeliveryRunIdentity,
    request: Intervention,
    viewer: Viewer,
  ) => Awaitable<InterventionResult>
  readonly onLeaseLost?: (
    identity: DeliveryRunIdentity,
    code: DeliveryRuntimeHostFailureCode,
  ) => void
  readonly onTerminal?: (
    host: DurableRunHost<F>,
    identity: DeliveryRunIdentity,
    result: RunResult<F>,
  ) => Awaitable<void>
}

export interface DeliveryRuntimeRegistry<
  F extends AnyWizard,
  Signal,
  Intervention,
  Viewer,
  SignalResult,
  InterventionResult,
> {
  recover(): Promise<void>
  isReady(): boolean
  get(tenantId: string, deliveryId: string): Promise<DurableRunHost<F>>
  signal(tenantId: string, deliveryId: string, signal: Signal): Promise<SignalResult>
  intervene(
    tenantId: string,
    deliveryId: string,
    request: Intervention,
    viewer: Viewer,
  ): Promise<InterventionResult>
  dispose(): Promise<void>
}

interface OpenRequest extends DeliveryRunIdentity {
  readonly mode: DeliveryRuntimeOpenMode
  readonly checkDelivery: boolean
}

class RuntimeRegistry<
  F extends AnyWizard,
  Signal,
  Intervention,
  Viewer,
  SignalResult,
  InterventionResult,
> implements
    DeliveryRuntimeRegistry<F, Signal, Intervention, Viewer, SignalResult, InterventionResult>
{
  private readonly opener: DeliveryRuntimeOpener<F>
  private readonly hosts
  private recovery: Promise<void> | undefined
  private disposal: Promise<void> | undefined
  private readonly terminalWrites = new WeakMap<DurableRunHost<F>, Promise<void>>()
  private recovered = false
  private disposed = false

  constructor(
    private readonly options: DeliveryRuntimeRegistryOptions<
      F,
      Signal,
      Intervention,
      Viewer,
      SignalResult,
      InterventionResult
    >,
  ) {
    this.opener = new DeliveryRuntimeOpener(options)
    this.hosts = createHostRegistry<OpenRequest, DurableRunHost<F>, never>({
      key: (identity) => deliveryRunKey(identity.tenantId, identity.deliveryId),
      open: (identity, context) => this.openHost(identity, context),
      close: (host) => host.dispose(),
    })
  }

  recover(): Promise<void> {
    this.ensureUsable()
    if (this.recovered) return Promise.resolve()
    if (this.recovery !== undefined) return this.recovery
    const recovery = recoverDeliveryRuntimes(
      () => this.options.repository.listActiveRuns(),
      (identity) => this.open(identity, 'resume', false),
    ).then(() => {
      this.ensureUsable()
      this.recovered = true
    })
    this.recovery = recovery
    void recovery.then(
      () => this.clearRecovery(recovery),
      () => this.clearRecovery(recovery),
    )
    return recovery
  }

  isReady(): boolean {
    return this.recovered && !this.disposed
  }

  get(tenantId: string, deliveryId: string): Promise<DurableRunHost<F>> {
    this.ensureUsable()
    return this.open({ tenantId, deliveryId }, 'create', true)
  }

  async signal(tenantId: string, deliveryId: string, signal: Signal): Promise<SignalResult> {
    const identity = { tenantId, deliveryId }
    const host = await this.get(tenantId, deliveryId)
    const result = await this.options.signal(host, identity, signal)
    await this.persistTerminal(host, identity)
    return result
  }

  async intervene(
    tenantId: string,
    deliveryId: string,
    request: Intervention,
    viewer: Viewer,
  ): Promise<InterventionResult> {
    const identity = { tenantId, deliveryId }
    const host = await this.get(tenantId, deliveryId)
    const result = await this.options.intervene(host, identity, request, viewer)
    await this.persistTerminal(host, identity)
    return result
  }

  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.disposed = true
    this.opener.dispose()
    const tasks =
      this.recovery === undefined ? [this.hosts.dispose()] : [this.hosts.dispose(), this.recovery]
    const disposal = Promise.all(tasks).then(() => undefined)
    this.disposal = disposal
    return disposal
  }

  private async openHost(
    request: OpenRequest,
    context: HostOpenContext,
  ): Promise<{ readonly ok: true; readonly value: DurableRunHost<F> }> {
    const identity = { tenantId: request.tenantId, deliveryId: request.deliveryId }
    if (
      request.checkDelivery &&
      !(await this.options.repository.hasDelivery(identity.tenantId, identity.deliveryId))
    )
      throw new DeliveryRuntimeRegistryError('DELIVERY_NOT_FOUND', identity)
    this.ensureUsable()
    const host = await this.opener.open(
      identity,
      deliveryRunKey(identity.tenantId, identity.deliveryId),
      request.mode,
      (_host, code) => {
        context.invalidate()
        this.options.onLeaseLost?.(identity, code)
      },
    )
    try {
      if (context.signal.aborted) throw new DeliveryRuntimeRegistryError('DISPOSED', identity)
      await this.options.initialize?.(host, identity)
      if (context.signal.aborted) throw new DeliveryRuntimeRegistryError('DISPOSED', identity)
      const result = host.run.result()
      if (result !== undefined) await this.persistTerminal(host, identity, result)
      else if (this.options.onTerminal !== undefined) {
        host.run.subscribeResult((terminal) => {
          // A failed projection write is retried when recovery reopens the still-active row.
          void this.persistTerminal(host, identity, terminal).catch(() => undefined)
        })
      }
      return { ok: true, value: host }
    } catch (error) {
      await host.dispose()
      throw error
    }
  }

  private async open(
    identity: DeliveryRunIdentity,
    mode: DeliveryRuntimeOpenMode,
    checkDelivery: boolean,
  ): Promise<DurableRunHost<F>> {
    const result = await this.hosts.open({ ...identity, mode, checkDelivery })
    if (result.ok) return result.value
    throw new DeliveryRuntimeRegistryError('DISPOSED', identity)
  }

  private clearRecovery(recovery: Promise<void>): void {
    if (this.recovery === recovery) this.recovery = undefined
  }

  private persistTerminal(
    host: DurableRunHost<F>,
    identity: DeliveryRunIdentity,
    result: RunResult<F> | undefined = host.run.result(),
  ): Promise<void> {
    if (result === undefined || this.options.onTerminal === undefined) return Promise.resolve()
    const existing = this.terminalWrites.get(host)
    if (existing !== undefined) return existing
    const write = Promise.resolve()
      .then(() => this.options.onTerminal?.(host, identity, result))
      .then(() => undefined)
    this.terminalWrites.set(host, write)
    void write.catch(() => {
      if (this.terminalWrites.get(host) === write) this.terminalWrites.delete(host)
    })
    return write
  }

  private ensureUsable(): void {
    if (this.disposed) throw new DeliveryRuntimeRegistryError('DISPOSED')
  }
}

export function createDeliveryRuntimeRegistry<
  F extends AnyWizard,
  Signal,
  Intervention,
  Viewer,
  SignalResult,
  InterventionResult,
>(
  options: DeliveryRuntimeRegistryOptions<
    F,
    Signal,
    Intervention,
    Viewer,
    SignalResult,
    InterventionResult
  >,
): DeliveryRuntimeRegistry<F, Signal, Intervention, Viewer, SignalResult, InterventionResult> {
  return new RuntimeRegistry(options)
}

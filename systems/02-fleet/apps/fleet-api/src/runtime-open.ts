import type { AnyWizard, Clock, Scheduler } from '@openwizard/core'
import {
  createDurableRun,
  type DurableResumeOptions,
  type DurableRunHost,
  type DurableRunOpenResult,
  type DurableRunOptions,
  resumeDurableRun,
} from '@openwizard/durable'
import type { DurableStore } from '@openwizard/durable/store'

export interface DeliveryRunIdentity {
  readonly tenantId: string
  readonly deliveryId: string
}

export type DeliveryRuntimeHostFailureCode = 'CAS_CONFLICT' | 'LEASE_LOST' | 'TIMER_CLAIM_LOST'
export type DeliveryRuntimeErrorCode =
  | DeliveryRuntimeHostFailureCode
  | 'DELIVERY_NOT_FOUND'
  | 'DISPOSED'
  | 'RUN_NOT_FOUND'

export class DeliveryRuntimeRegistryError extends Error {
  constructor(
    readonly code: DeliveryRuntimeErrorCode,
    readonly identity?: DeliveryRunIdentity,
  ) {
    const resource =
      identity === undefined ? '' : ` for ${identity.tenantId}/${identity.deliveryId}`
    super(`Delivery runtime registry ${code.toLowerCase().replaceAll('_', ' ')}${resource}`)
    this.name = 'DeliveryRuntimeRegistryError'
  }
}

export interface DeliveryHostOptions {
  readonly store: DurableStore
  readonly key: string
  readonly ownerId: string
  readonly scheduler: Scheduler
  readonly clock: Clock
  readonly onLeaseLost: (code: DeliveryRuntimeHostFailureCode) => void
}

type Awaitable<T> = T | PromiseLike<T>

export interface DeliveryRuntimeOpenDependencies<F extends AnyWizard> {
  readonly flow: F
  readonly store: DurableStore
  readonly scheduler: Scheduler
  readonly clock: Clock
  readonly ownerId: string
  readonly createOptions: (
    identity: DeliveryRunIdentity,
    host: DeliveryHostOptions,
  ) => Awaitable<DurableRunOptions<F>>
  readonly resumeOptions: (
    identity: DeliveryRunIdentity,
    host: DeliveryHostOptions,
  ) => Awaitable<DurableResumeOptions<F>>
}

export type DeliveryRuntimeOpenMode = 'create' | 'resume'
export type LeaseLossHandler<F extends AnyWizard> = (
  host: DurableRunHost<F> | undefined,
  code: DeliveryRuntimeHostFailureCode,
) => void

export class DeliveryRuntimeOpener<F extends AnyWizard> {
  private readonly retryCancels = new Set<() => void>()
  private disposed = false

  constructor(private readonly dependencies: DeliveryRuntimeOpenDependencies<F>) {}

  async open(
    identity: DeliveryRunIdentity,
    key: string,
    initialMode: DeliveryRuntimeOpenMode,
    onLeaseLost: LeaseLossHandler<F>,
  ): Promise<DurableRunHost<F>> {
    this.ensureUsable()
    let mode = initialMode
    let createOptions: DurableRunOptions<F> | undefined
    let resumeOptions: DurableResumeOptions<F> | undefined
    let ownedHost: DurableRunHost<F> | undefined
    let lostCode: DeliveryRuntimeHostFailureCode | undefined
    const lost = (code: DeliveryRuntimeHostFailureCode): void => {
      lostCode = code
      onLeaseLost(ownedHost, code)
    }
    const hostOptions: DeliveryHostOptions = {
      store: this.dependencies.store,
      key,
      ownerId: this.dependencies.ownerId,
      scheduler: this.dependencies.scheduler,
      clock: this.dependencies.clock,
      onLeaseLost: lost,
    }

    while (true) {
      this.ensureUsable()
      let result: DurableRunOpenResult<F>
      if (mode === 'resume') {
        resumeOptions ??= await this.dependencies.resumeOptions(identity, hostOptions)
        this.ensureUsable()
        result = await resumeDurableRun(this.dependencies.flow, {
          ...resumeOptions,
          ...hostOptions,
        })
      } else {
        createOptions ??= await this.dependencies.createOptions(identity, hostOptions)
        this.ensureUsable()
        result = await createDurableRun(this.dependencies.flow, {
          ...createOptions,
          ...hostOptions,
        })
      }
      if (result.ok) {
        ownedHost = result.host
        if (this.disposed || lostCode !== undefined) {
          await result.host.dispose()
          throw new DeliveryRuntimeRegistryError(lostCode ?? 'DISPOSED', identity)
        }
        return result.host
      }
      if (result.code === 'LEASE_BUSY') {
        await this.waitUntil(result.retryAt)
        continue
      }
      if (result.code === 'RUN_NOT_FOUND' && mode === 'resume') {
        mode = 'create'
        continue
      }
      throw new DeliveryRuntimeRegistryError(result.code, identity)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const cancel of [...this.retryCancels]) cancel()
  }

  private waitUntil(retryAt: number): Promise<void> {
    this.ensureUsable()
    const delay = Number.isFinite(retryAt)
      ? Math.max(0, retryAt - this.dependencies.clock.now())
      : 0
    return new Promise<void>((resolve, reject) => {
      let settled = false
      let handle: unknown
      const finish = (complete: () => void): void => {
        if (settled) return
        settled = true
        this.retryCancels.delete(cancel)
        complete()
      }
      const cancel = (): void => {
        this.dependencies.scheduler.clearTimeout(handle)
        finish(() => reject(new DeliveryRuntimeRegistryError('DISPOSED')))
      }
      this.retryCancels.add(cancel)
      try {
        handle = this.dependencies.scheduler.setTimeout(() => finish(resolve), delay)
      } catch (error) {
        finish(() => reject(error))
      }
    })
  }

  private ensureUsable(): void {
    if (this.disposed) throw new DeliveryRuntimeRegistryError('DISPOSED')
  }
}

export async function recoverDeliveryRuntimes(
  list: () => Promise<readonly DeliveryRunIdentity[]>,
  open: (identity: DeliveryRunIdentity) => Promise<unknown>,
): Promise<void> {
  const active = await list()
  await Promise.all(active.map(open))
}

export function deliveryRunKey(tenantId: string, deliveryId: string): string {
  if (tenantId.length === 0) throw new TypeError('Invalid tenant id')
  if (deliveryId.length === 0) throw new TypeError('Invalid delivery id')
  return `${encodeURIComponent(tenantId)}:${encodeURIComponent(deliveryId)}`
}

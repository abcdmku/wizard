import {
  customerStatus,
  type FulfillmentDependencies,
  fulfillmentWizard,
} from '@fulfillment/domain'
import {
  createDurableRun,
  createHostRegistry,
  type DurableRunHost,
  type HostOpenContext,
  type HostOpenResult,
  type HostRegistryOpenResult,
} from '@openwizard/durable'
import type { DurableStore } from '@openwizard/durable/store'
import type { OrderCatalog, OrderRecord } from './catalog'
import { FulfillmentServiceError } from './errors'

type Host = DurableRunHost<typeof fulfillmentWizard>
type State = ReturnType<Host['run']['getState']>

interface RegistryEntry {
  readonly host: Host
  unsubscribe: () => void
}

type RegistryOpenFailure =
  | { readonly ok: false; readonly code: 'WORKFLOW_BUSY'; readonly retryAt: number }
  | { readonly ok: false; readonly code: 'WORKFLOW_REJECTED'; readonly reason: string }

interface HostCache {
  open(record: OrderRecord): Promise<HostRegistryOpenResult<RegistryEntry, RegistryOpenFailure>>
  cached(record: OrderRecord): RegistryEntry | undefined
  evict(record: OrderRecord, expected: RegistryEntry): Promise<boolean>
  dispose(): Promise<void>
}

interface RegistryOptions {
  readonly store: DurableStore
  readonly catalog: OrderCatalog
  readonly deps: FulfillmentDependencies
  readonly ownerId: string
  readonly leaseTtlMs: number
  readonly renewEveryMs: number
}

export class DurableOrderRegistry {
  private readonly hosts: HostCache

  constructor(private readonly options: RegistryOptions) {
    this.hosts = createHostRegistry<OrderRecord, RegistryEntry, RegistryOpenFailure>({
      key: (record) => record.orderId,
      open: (record, lifecycle) => this.openWithLeaseRetry(record, lifecycle),
      close: async (entry) => {
        entry.unsubscribe()
        await entry.host.dispose()
      },
    })
  }

  async open(record: OrderRecord): Promise<Host> {
    const opened = await this.hosts.open(record)
    if (!opened.ok) {
      if (opened.code === 'WORKFLOW_BUSY') {
        throw new FulfillmentServiceError(
          'WORKFLOW_BUSY',
          'Another orchestrator owns this order workflow',
          503,
          opened.retryAt,
        )
      }
      if (opened.code === 'WORKFLOW_REJECTED') {
        throw new FulfillmentServiceError(
          'WORKFLOW_REJECTED',
          `Could not open order workflow: ${opened.reason}`,
          503,
        )
      }
      throw new FulfillmentServiceError('WORKFLOW_BUSY', 'Workflow registry is unavailable', 503)
    }
    if (this.hosts.cached(record) !== opened.value) {
      throw new FulfillmentServiceError(
        'WORKFLOW_BUSY',
        'Workflow lease was lost while opening',
        503,
      )
    }
    return opened.value.host
  }

  async recover(): Promise<void> {
    const records = await this.options.catalog.listActive()
    const results = await Promise.allSettled(records.map((record) => this.open(record)))
    for (const result of results) {
      if (result.status === 'rejected') {
        process.stderr.write(`Active order recovery failed: ${safeMessage(result.reason)}\n`)
      }
    }
  }

  disposeAll(): Promise<void> {
    return this.hosts.dispose()
  }

  private async openWithLeaseRetry(
    record: OrderRecord,
    lifecycle: HostOpenContext,
  ): Promise<HostOpenResult<RegistryEntry, RegistryOpenFailure>> {
    let lastRetryAt = Date.now()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (lifecycle.signal.aborted) return busy(lastRetryAt)
      const opened = await createDurableRun(fulfillmentWizard, {
        context: record.initialContext,
        deps: this.options.deps,
        store: this.options.store,
        key: runKey(record),
        ownerId: `${this.options.ownerId}:${record.orderId}`,
        instanceId: record.orderId,
        correlationId: record.orderId,
        lease: { ttlMs: this.options.leaseTtlMs },
        renew: { everyMs: this.options.renewEveryMs },
        onLeaseLost: lifecycle.invalidate,
      })
      if (opened.ok) return this.prepareEntry(record, opened.host)
      if (opened.code !== 'LEASE_BUSY') {
        return { ok: false, code: 'WORKFLOW_REJECTED', reason: opened.code }
      }
      lastRetryAt = opened.retryAt
      await delay(
        Math.max(1, Math.min(opened.retryAt - Date.now() + 10, this.options.leaseTtlMs)),
        lifecycle.signal,
      )
    }
    return busy(lastRetryAt)
  }

  private async prepareEntry(
    record: OrderRecord,
    host: Host,
  ): Promise<HostOpenResult<RegistryEntry, RegistryOpenFailure>> {
    const entry = this.attach(record, host)
    try {
      const state = host.run.getState()
      await this.sync(record.orderId, state)
      if (terminal(state.status)) this.scheduleClose(record, entry)
      return { ok: true, value: entry }
    } catch (error) {
      entry.unsubscribe()
      await host.dispose()
      throw error
    }
  }

  private attach(record: OrderRecord, host: Host): RegistryEntry {
    const entry: RegistryEntry = { host, unsubscribe: () => undefined }
    entry.unsubscribe = host.run.subscribe((state) => {
      void this.sync(record.orderId, state).catch((error: unknown) => {
        process.stderr.write(`Order status sync failed: ${safeMessage(error)}\n`)
      })
      if (terminal(state.status)) this.scheduleClose(record, entry)
    })
    return entry
  }

  private async sync(orderId: string, state: State): Promise<void> {
    await this.options.catalog.updateRuntime(
      orderId,
      customerStatus(state),
      !terminal(state.status),
      state.context.updatedAt,
    )
  }

  private scheduleClose(record: OrderRecord, entry: RegistryEntry): void {
    setTimeout(() => {
      void this.hosts.evict(record, entry).catch((error: unknown) => {
        process.stderr.write(`Order host eviction failed: ${safeMessage(error)}\n`)
      })
    }, 250)
  }
}

function runKey(record: OrderRecord): string {
  return `tenant/${record.tenantId}/orders/${record.orderId}`
}

function terminal(status: string): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled'
}

function busy(retryAt: number): RegistryOpenFailure {
  return { ok: false, code: 'WORKFLOW_BUSY', retryAt }
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds)
    signal.addEventListener('abort', done, { once: true })

    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error'
}

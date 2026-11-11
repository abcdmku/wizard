import { createHash } from 'node:crypto'
import { parseCommand } from '@openwizard/core'
import {
  createDurableRun,
  createHostRegistry,
  type HostOpenContext,
  type HostOpenResult,
  type HostRegistryOpenResult,
  resumeDurableRun,
} from '@openwizard/durable'
import type { ReviewerCommand, ReviewerViewer, Viewer } from '../../shared/index.js'
import { type ApplicationRecord, intakeRunKey } from '../db/index.js'
import { authorizeIntakeCommand, intakeWizard, migrateIntakeSnapshot } from '../workflow/index.js'
import { canAccessApplication, disposed, forbidden, notFound } from './access.js'
import { coreCommandInput } from './commands.js'
import { type RuntimeEntry, settleEntryMetadata, trackEntry } from './entry.js'
import { invalidateAfterDraftMutation, isDraftMutation } from './invalidation.js'
import { projectApplication } from './projection.js'
import type {
  IntakeRuntimeRegistryOptions,
  IntakeRuntimeService,
  ReopenActiveOptions,
  ReopenActiveResult,
  RuntimeFailure,
} from './types.js'
import { waitUntil as nativeWaitUntil } from './wait.js'

const DEFAULT_LEASE_TTL_MS = 6_000
const DEFAULT_RENEW_EVERY_MS = 2_000

interface RuntimeIdentity {
  readonly applicationId: string
  readonly application?: ApplicationRecord
}

export function createIntakeRuntimeRegistry(
  options: IntakeRuntimeRegistryOptions,
): IntakeRuntimeService {
  const now = options.now ?? (() => new Date())
  const onError = options.onError ?? (() => undefined)
  const waitUntil = options.waitUntil ?? nativeWaitUntil
  let shutdownRequested = false
  const hosts = createHostRegistry<RuntimeIdentity, RuntimeEntry, RuntimeFailure>({
    key: (identity) => identity.applicationId,
    open: createEntry,
    close: closeEntry,
  })

  async function open(application: ApplicationRecord): Promise<RuntimeEntry | RuntimeFailure> {
    return unwrapOpenResult(await hosts.open({ applicationId: application.id, application }))
  }

  async function createEntry(
    identity: RuntimeIdentity,
    context: HostOpenContext,
  ): Promise<HostOpenResult<RuntimeEntry, RuntimeFailure>> {
    const application = identity.application
    if (application === undefined) return notFound(identity.applicationId)
    const hostOptions = {
      deps: options.deps,
      store: options.durableStore,
      key: intakeRunKey(application.tenantId, application.id),
      ownerId: options.ownerId,
      lease: { ttlMs: options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS },
      renew: { everyMs: options.renewEveryMs ?? DEFAULT_RENEW_EVERY_MS },
      ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
      onLeaseLost: context.invalidate,
    }
    // Resume first: only a resume takes `migrate`, which a run saved by version 1 needs.
    let opened = await resumeDurableRun(intakeWizard, {
      ...hostOptions,
      migrate: migrateIntakeSnapshot,
    })
    if (!opened.ok && opened.code === 'RUN_NOT_FOUND') {
      opened = await createDurableRun(intakeWizard, {
        ...hostOptions,
        context: {
          applicationId: application.id,
          tenantId: application.tenantId,
          applicantId: application.applicantId,
          applicantName: application.applicantName,
        },
      })
    }
    if (!opened.ok) {
      if (opened.code === 'LEASE_BUSY') {
        return {
          ok: false,
          code: 'LEASE_BUSY',
          message: 'application is owned by another API process',
          retryAt: opened.retryAt,
        }
      }
      return { ok: false, code: 'LEASE_LOST', message: 'application lease was lost' }
    }
    if (context.signal.aborted) {
      await opened.host.dispose()
      return { ok: false, code: 'LEASE_LOST', message: 'application lease was lost' }
    }
    const tracked: RuntimeEntry = {
      key: intakeRunKey(application.tenantId, application.id),
      host: opened.host,
      application,
      unsubscribeLifecycle: () => undefined,
      metadataTail: Promise.resolve(),
    }
    trackEntry(tracked, { applications: options.applications, now, onError })
    if (opened.host.run.getState().status === 'idle') {
      const started = await opened.host.dispatch(
        { type: 'start' },
        { commandId: `system:start:${application.id}` },
      )
      if (!started.ok && started.code === 'LEASE_LOST') {
        context.invalidate()
        await closeEntry(tracked)
        return { ok: false, code: 'LEASE_LOST', message: 'application lease was lost' }
      }
    }
    if (context.signal.aborted) {
      await closeEntry(tracked)
      return { ok: false, code: 'LEASE_LOST', message: 'application lease was lost' }
    }
    return { ok: true, value: tracked }
  }

  async function closeEntry(entry: RuntimeEntry): Promise<void> {
    entry.unsubscribeLifecycle()
    await settleEntryMetadata(entry)
    await entry.host.dispose()
  }

  async function find(
    applicationId: string,
    viewer?: Viewer,
  ): Promise<RuntimeEntry | RuntimeFailure> {
    if (shutdownRequested) return disposed()
    const cached = hosts.cached({ applicationId })
    const application = cached?.application ?? (await options.applications.getById(applicationId))
    if (application === null) return notFound(applicationId)
    if (viewer !== undefined && !canAccessApplication(viewer, application)) return forbidden()
    return cached ?? open(application)
  }

  const service: IntakeRuntimeService = {
    async dispatch(applicationId, viewer, command) {
      const entry = await find(applicationId, viewer)
      if (isFailure(entry)) return entry
      const parsed = parseCommand(intakeWizard, coreCommandInput(command))
      if (!parsed.ok) {
        return {
          ok: false,
          code: 'INVALID_COMMAND',
          message: 'command failed validation',
          issues: parsed.issues,
        }
      }
      if (
        !authorizeIntakeCommand({
          state: entry.host.run.getState(),
          command: parsed.value,
          scope: viewer,
        })
      ) {
        return forbidden()
      }
      const result = await entry.host.dispatch(parsed.value, {
        commandId: command.commandId,
        ...(command.expectedVersion === undefined
          ? {}
          : { expectedVersion: command.expectedVersion }),
      })
      if (result.ok && isDraftMutation(parsed.value)) {
        const invalidated = await invalidateAfterDraftMutation(
          entry.host,
          parsed.value,
          command.commandId,
        )
        if (invalidated !== undefined && !invalidated.ok) return invalidated
      }
      return result
    },

    async completeRisk(applicationId, event, eventId) {
      const entry = await find(applicationId)
      if (isFailure(entry)) return entry
      return entry.host.send('risk.completed', event, { eventId })
    },

    async decideReview(applicationId, viewer, command) {
      const entry = await find(applicationId, viewer)
      if (isFailure(entry)) return entry
      const wire = reviewEvent(command, viewer, now())
      const state = entry.host.run.getState()
      const redelivery = state.eventIds?.some(({ id }) => id === command.commandId) ?? false
      if (state.steps.manualReview.status !== 'active' && !redelivery) return forbidden()
      return entry.host.dispatch(
        {
          type: 'send',
          event: 'review.decided',
          payload: wire,
          eventId: command.commandId,
        },
        {
          commandId: command.commandId,
          // A retry keeps the client request identity even though decidedAt was generated again.
          digest: createHash('sha256')
            .update(JSON.stringify({ reviewerId: viewer.reviewerId, command }))
            .digest('hex'),
          ...(command.expectedVersion === undefined
            ? {}
            : { expectedVersion: command.expectedVersion }),
        },
      )
    },

    async project(applicationId, viewer) {
      const entry = await find(applicationId, viewer)
      if (isFailure(entry)) return entry
      const projected = projectApplication(entry.host, entry.application, viewer)
      return projected.ok
        ? { ok: true, application: projected.application, version: entry.host.version }
        : projected
    },

    async subscribe(applicationId, viewer, listener) {
      const entry = await find(applicationId, viewer)
      if (isFailure(entry)) return entry
      const initial = projectApplication(entry.host, entry.application, viewer)
      if (!initial.ok) return initial
      listener({ type: 'snapshot', data: initial.application })
      const unsubscribe = entry.host.run.subscribe(() => {
        const projected = projectApplication(entry.host, entry.application, viewer)
        if (projected.ok) listener({ type: 'state', data: projected.application })
      })
      return { ok: true, unsubscribe }
    },

    async reopenActive(reopenOptions = {}) {
      return reopenActive(reopenOptions)
    },
    activeCount: () => hosts.values().length,
    async shutdown() {
      shutdownRequested = true
      await hosts.dispose()
    },
  }

  async function reopenActive(reopenOptions: ReopenActiveOptions): Promise<ReopenActiveResult> {
    const pageSize = readPageSize(reopenOptions.pageSize)
    let afterId: string | undefined
    let opened = 0
    let alreadyOpen = 0
    let leaseBusyRetries = 0
    while (!shutdownRequested && !signalAborted(reopenOptions.signal)) {
      const page = await options.applications.listActive({
        ...(afterId === undefined ? {} : { afterId }),
        limit: pageSize,
      })
      if (page.length === 0) break
      for (const application of page) {
        if (hosts.cached({ applicationId: application.id }) !== undefined) {
          alreadyOpen += 1
          continue
        }
        let result = await open(application)
        while (isLeaseBusy(result)) {
          if (shutdownRequested || signalAborted(reopenOptions.signal)) break
          leaseBusyRetries += 1
          await waitUntil(result.retryAt, reopenOptions.signal)
          result = await open(application)
        }
        if (!isFailure(result)) opened += 1
      }
      const last = page.at(-1)
      if (last === undefined || page.length < pageSize) break
      afterId = last.id
    }
    return { opened, alreadyOpen, leaseBusyRetries }
  }

  return service
}

function unwrapOpenResult(
  result: HostRegistryOpenResult<RuntimeEntry, RuntimeFailure>,
): RuntimeEntry | RuntimeFailure {
  if (result.ok) return result.value
  return result.code === 'HOST_REGISTRY_DISPOSED' ? disposed() : result
}

function reviewEvent(command: ReviewerCommand, viewer: ReviewerViewer, decidedAt: Date) {
  return {
    decision: command.type,
    reviewerId: viewer.reviewerId,
    reason: command.reason,
    requestedFields: command.requestedFields,
    decidedAt: decidedAt.toISOString(),
  }
}

function isFailure(value: RuntimeEntry | RuntimeFailure): value is RuntimeFailure {
  return 'ok' in value && value.ok === false
}

function isLeaseBusy(
  value: RuntimeEntry | RuntimeFailure,
): value is Extract<RuntimeFailure, { code: 'LEASE_BUSY' }> {
  return isFailure(value) && value.code === 'LEASE_BUSY'
}

function readPageSize(value: number | undefined): number {
  const pageSize = value ?? 100
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) {
    throw new RangeError('pageSize must be an integer from 1 through 500')
  }
  return pageSize
}

function signalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

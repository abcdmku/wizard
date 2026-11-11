import type { DurableRunHost } from '@openwizard/durable'
import type { ApplicationRecord, ApplicationRepository } from '../db/index.js'
import type { IntakeWizard } from '../workflow/index.js'

export interface RuntimeEntry {
  readonly key: string
  readonly host: DurableRunHost<IntakeWizard>
  application: ApplicationRecord
  unsubscribeLifecycle: () => void
  metadataTail: Promise<void>
}

interface TrackEntryOptions {
  readonly applications: ApplicationRepository
  readonly now: () => Date
  readonly onError: (error: unknown) => void
}

export function trackEntry(entry: RuntimeEntry, options: TrackEntryOptions): void {
  entry.unsubscribeLifecycle = entry.host.run.subscribe(() => queueMetadataSync(entry, options))
  queueMetadataSync(entry, options)
}

export async function settleEntryMetadata(entry: RuntimeEntry): Promise<void> {
  await entry.metadataTail
}

function queueMetadataSync(entry: RuntimeEntry, options: TrackEntryOptions): void {
  const terminal = isTerminal(entry.host.run.getState().status)
  const changedAt = options.now()
  entry.application = {
    ...entry.application,
    updatedAt: changedAt,
    terminalAt: terminal ? changedAt : null,
  }
  const previous = entry.metadataTail
  entry.metadataTail = previous
    .then(async () => {
      const updated = terminal
        ? await options.applications.markTerminal(
            entry.application.tenantId,
            entry.application.id,
            changedAt,
          )
        : await options.applications.markActive(entry.application.tenantId, entry.application.id)
      if (updated !== null && updated.updatedAt >= entry.application.updatedAt) {
        entry.application = updated
      }
    })
    .catch(options.onError)
}

function isTerminal(status: string): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled'
}

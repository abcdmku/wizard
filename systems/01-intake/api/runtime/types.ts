import type { Issue, Scheduler } from '@openwizard/core'
import type { DurableCommandResult, DurableEventResult } from '@openwizard/durable'
import type { DurableStore, Version } from '@openwizard/durable/store'
import type {
  ApplicationCommand,
  ApplicationStreamEvent,
  ApplicationView,
  ReviewerCommand,
  ReviewerViewer,
  RiskCompletedEvent,
  Viewer,
} from '../../shared/index.js'
import type { ApplicationRepository } from '../db/index.js'
import type { IntakeDeps } from '../workflow/index.js'

export type RuntimeFailure =
  | { readonly ok: false; readonly code: 'NOT_FOUND'; readonly message: string }
  | { readonly ok: false; readonly code: 'FORBIDDEN'; readonly message: string }
  | {
      readonly ok: false
      readonly code: 'LEASE_BUSY'
      readonly message: string
      readonly retryAt: number
    }
  | { readonly ok: false; readonly code: 'LEASE_LOST'; readonly message: string }
  | { readonly ok: false; readonly code: 'DISPOSED'; readonly message: string }

export interface InvalidCommandFailure {
  readonly ok: false
  readonly code: 'INVALID_COMMAND'
  readonly message: string
  readonly issues: readonly Issue[]
}

export type IntakeDispatchResult = DurableCommandResult | RuntimeFailure | InvalidCommandFailure
export type IntakeEventResult = DurableEventResult | RuntimeFailure

export type IntakeProjectResult =
  | RuntimeFailure
  | {
      readonly ok: true
      readonly application: ApplicationView
      readonly version: Version
    }

export type IntakeSubscriptionResult =
  | RuntimeFailure
  | { readonly ok: true; readonly unsubscribe: () => void }

export interface ReopenActiveResult {
  readonly opened: number
  readonly alreadyOpen: number
  readonly leaseBusyRetries: number
}

export interface ReopenActiveOptions {
  readonly pageSize?: number
  readonly signal?: AbortSignal
}

export interface IntakeRuntimeService {
  dispatch(
    applicationId: string,
    viewer: Viewer,
    command: ApplicationCommand,
  ): Promise<IntakeDispatchResult>
  completeRisk(
    applicationId: string,
    event: RiskCompletedEvent,
    eventId: string,
  ): Promise<IntakeEventResult>
  decideReview(
    applicationId: string,
    viewer: ReviewerViewer,
    command: ReviewerCommand,
  ): Promise<IntakeDispatchResult>
  project(applicationId: string, viewer: Viewer): Promise<IntakeProjectResult>
  subscribe(
    applicationId: string,
    viewer: Viewer,
    listener: (event: ApplicationStreamEvent) => void,
  ): Promise<IntakeSubscriptionResult>
  reopenActive(options?: ReopenActiveOptions): Promise<ReopenActiveResult>
  activeCount(): number
  shutdown(): Promise<void>
}

export interface IntakeRuntimeRegistryOptions {
  readonly applications: ApplicationRepository
  readonly durableStore: DurableStore
  readonly deps: IntakeDeps
  readonly ownerId: string
  readonly leaseTtlMs?: number
  readonly renewEveryMs?: number
  readonly scheduler?: Scheduler
  readonly now?: () => Date
  readonly waitUntil?: (timestamp: number, signal?: AbortSignal) => Promise<void>
  readonly onError?: (error: unknown) => void
}

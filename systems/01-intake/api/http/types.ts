import type { z } from 'zod'
import type {
  ApplicationCommand,
  ApplicationView,
  CommandResponse,
  CreateApplicationRequest,
  DemoActionResponse,
  ReviewerCommand,
  ReviewerQueueSchema,
} from '../../shared/api-contract.js'
import type { ApplicantViewer, ReviewerViewer, Viewer } from '../../shared/common.js'

export type IntakeHttpMaybePromise<T> = T | Promise<T>
export type ReviewerQueue = z.infer<typeof ReviewerQueueSchema>

export interface IntakeHttpSubscription {
  readonly initial: ApplicationView
  close(): IntakeHttpMaybePromise<void>
}

export interface IntakeHttpService {
  createApplication(
    scope: ApplicantViewer,
    input: CreateApplicationRequest,
  ): IntakeHttpMaybePromise<ApplicationView>
  getApplication(scope: Viewer, applicationId: string): IntakeHttpMaybePromise<ApplicationView>
  listReviewer(scope: ReviewerViewer): IntakeHttpMaybePromise<ReviewerQueue>
  dispatch(
    scope: ApplicantViewer,
    applicationId: string,
    command: ApplicationCommand,
  ): IntakeHttpMaybePromise<CommandResponse>
  review(
    scope: ReviewerViewer,
    applicationId: string,
    command: ReviewerCommand,
  ): IntakeHttpMaybePromise<CommandResponse>
  subscribe(
    scope: ApplicantViewer,
    applicationId: string,
    onApplication: (application: ApplicationView) => void,
  ): IntakeHttpMaybePromise<IntakeHttpSubscription>
  seed(scope: ReviewerViewer): IntakeHttpMaybePromise<DemoActionResponse>
  reset(scope: ReviewerViewer): IntakeHttpMaybePromise<DemoActionResponse>
}

export interface IntakeHttpPluginOptions {
  readonly heartbeatMs?: number
  readonly service: IntakeHttpService
}

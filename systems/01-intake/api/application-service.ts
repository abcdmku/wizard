import { randomUUID } from 'node:crypto'
import type { Issue } from '@openwizard/core'
import {
  type ApplicationCommand,
  type ApplicationView,
  ApplicationViewSchema,
  type CommandResponse,
  CommandResponseSchema,
  type CreateApplicationRequest,
  type DemoActionResponse,
  DemoActionResponseSchema,
  type ReviewerCommand,
  ReviewerQueueSchema,
} from '../shared/api-contract.js'
import type { ApplicantViewer, ReviewerViewer, ValidationIssue, Viewer } from '../shared/common.js'
import type { IntakeDatabase } from './db/index.js'
import { DEMO_APPLICATION_ID, seedManualReviewDemo } from './demo-seed.js'
import { IntakeHttpError, statusForCode } from './http/errors.js'
import type { IntakeHttpService, IntakeHttpSubscription, ReviewerQueue } from './http/types.js'
import type { IntakeDispatchResult, IntakeRuntimeService, RuntimeFailure } from './runtime/index.js'

export { DEMO_APPLICATION_ID } from './demo-seed.js'

export interface CreateIntakeApplicationServiceOptions {
  readonly database: IntakeDatabase
  readonly runtimeFactory: () => IntakeRuntimeService
  readonly newId?: () => string
}

export class IntakeApplicationService implements IntakeHttpService {
  readonly #database: IntakeDatabase
  readonly #newId: () => string
  readonly #runtimeFactory: () => IntakeRuntimeService
  #currentRuntime: IntakeRuntimeService
  #resetTail: Promise<void> = Promise.resolve()

  constructor(options: CreateIntakeApplicationServiceOptions) {
    this.#database = options.database
    this.#newId = options.newId ?? randomUUID
    this.#runtimeFactory = options.runtimeFactory
    this.#currentRuntime = options.runtimeFactory()
  }

  runtime(): IntakeRuntimeService {
    return this.#currentRuntime
  }

  async shutdown(): Promise<void> {
    await this.#resetTail
    await this.#currentRuntime.shutdown()
  }

  async createApplication(
    scope: ApplicantViewer,
    input: CreateApplicationRequest,
  ): Promise<ApplicationView> {
    const runtime = await this.#readyRuntime()
    const applicationId = this.#newId()
    await this.#database.applications.create({
      id: applicationId,
      tenantId: scope.tenantId,
      applicantId: scope.applicantId,
      applicantName: input.applicantName,
    })
    return project(runtime, applicationId, scope)
  }

  async getApplication(scope: Viewer, applicationId: string): Promise<ApplicationView> {
    return project(await this.#readyRuntime(), applicationId, scope)
  }

  async listReviewer(scope: ReviewerViewer): Promise<ReviewerQueue> {
    const runtime = await this.#readyRuntime()
    const records = await this.#database.applications.list({ tenantId: scope.tenantId })
    const applications = await Promise.all(
      records.map(async ({ id }) => queueItem(await project(runtime, id, scope))),
    )
    return ReviewerQueueSchema.parse({ applications })
  }

  async dispatch(
    scope: ApplicantViewer,
    applicationId: string,
    command: ApplicationCommand,
  ): Promise<CommandResponse> {
    const runtime = await this.#readyRuntime()
    const result = await runtime.dispatch(applicationId, scope, command)
    return commandResponse(runtime, applicationId, scope, result)
  }

  async review(
    scope: ReviewerViewer,
    applicationId: string,
    command: ReviewerCommand,
  ): Promise<CommandResponse> {
    const runtime = await this.#readyRuntime()
    const result = await runtime.decideReview(applicationId, scope, command)
    return commandResponse(runtime, applicationId, scope, result)
  }

  async subscribe(
    scope: ApplicantViewer,
    applicationId: string,
    onApplication: (application: ApplicationView) => void,
  ): Promise<IntakeHttpSubscription> {
    const runtime = await this.#readyRuntime()
    const pending: ApplicationView[] = []
    let initial: ApplicationView | undefined
    let ready = false
    const subscribed = await runtime.subscribe(applicationId, scope, (event) => {
      if (event.type === 'heartbeat') return
      const application = ApplicationViewSchema.parse(event.data)
      if (initial === undefined) {
        initial = application
      } else if (ready) {
        onApplication(application)
      } else {
        pending.push(application)
      }
    })
    if (!subscribed.ok) throw runtimeHttpError(subscribed)

    let snapshot: ApplicationView
    try {
      snapshot = initial ?? (await project(runtime, applicationId, scope))
      ready = true
      for (const application of pending) onApplication(application)
    } catch (error) {
      subscribed.unsubscribe()
      throw error
    }
    let closed = false
    return {
      initial: ApplicationViewSchema.parse(snapshot),
      close: () => {
        if (closed) return
        closed = true
        subscribed.unsubscribe()
      },
    }
  }

  async seed(scope: ReviewerViewer): Promise<DemoActionResponse> {
    const runtime = await this.#readyRuntime()
    await seedManualReviewDemo({ database: this.#database, runtime, scope })
    return DemoActionResponseSchema.parse({
      ok: true,
      action: 'seeded',
      applicationIds: [DEMO_APPLICATION_ID],
    })
  }

  async reset(scope: ReviewerViewer): Promise<DemoActionResponse> {
    const reset = this.#resetTail.then(async () => {
      const runtime = this.#currentRuntime
      await runtime.shutdown()
      try {
        await this.#database.resetTenant(scope.tenantId)
      } finally {
        this.#currentRuntime = this.#runtimeFactory()
      }
    })
    this.#resetTail = reset.catch(() => undefined)
    await reset
    return DemoActionResponseSchema.parse({ ok: true, action: 'reset', applicationIds: [] })
  }

  async #readyRuntime(): Promise<IntakeRuntimeService> {
    await this.#resetTail
    return this.#currentRuntime
  }
}

export function createIntakeApplicationService(
  options: CreateIntakeApplicationServiceOptions,
): IntakeApplicationService {
  return new IntakeApplicationService(options)
}

async function project(
  runtime: IntakeRuntimeService,
  applicationId: string,
  scope: Viewer,
): Promise<ApplicationView> {
  const result = await runtime.project(applicationId, scope)
  if (!result.ok) throw runtimeHttpError(result)
  return ApplicationViewSchema.parse(result.application)
}

async function commandResponse(
  runtime: IntakeRuntimeService,
  applicationId: string,
  scope: Viewer,
  result: IntakeDispatchResult,
): Promise<CommandResponse> {
  if (!result.ok) {
    const issues = 'issues' in result ? validationIssues(result.issues) : undefined
    const version = 'actual' in result && result.actual !== null ? result.actual : undefined
    return CommandResponseSchema.parse({
      ok: false,
      code: result.code,
      replayed: false,
      ...(issues === undefined ? {} : { issues }),
      ...(version === undefined ? {} : { version }),
    })
  }

  const inner = result.result
  const issues = !inner.ok && 'issues' in inner ? validationIssues(inner.issues) : undefined
  return CommandResponseSchema.parse({
    ok: true,
    code: inner.ok ? 'OK' : inner.code,
    replayed: result.status === 'replayed',
    version: result.version,
    ...(issues === undefined ? {} : { issues }),
    application: await project(runtime, applicationId, scope),
  })
}

function queueItem(application: ApplicationView): ReviewerQueue['applications'][number] {
  const { context } = application.workflow
  return {
    id: application.id,
    applicantName: application.applicantName,
    status: application.status,
    updatedAt: application.updatedAt,
    ...(context.requestedAmount === undefined ? {} : { requestedAmount: context.requestedAmount }),
    ...(context.riskOutcome === undefined ? {} : { riskOutcome: context.riskOutcome }),
  }
}

function validationIssues(issues: readonly Issue[]): ValidationIssue[] {
  return issues.map((issue) => ({
    message: issue.message,
    path: (issue.path ?? []).map((part) =>
      issuePathPart(typeof part === 'object' ? part.key : part),
    ),
  }))
}

function issuePathPart(part: PropertyKey): string | number {
  if (typeof part === 'number' && Number.isSafeInteger(part) && part >= 0) return part
  if (typeof part === 'symbol') return part.description ?? part.toString()
  return String(part)
}

function runtimeHttpError(failure: RuntimeFailure): IntakeHttpError {
  return new IntakeHttpError({
    code: failure.code,
    message: failure.message,
    statusCode: statusForCode(failure.code, failure.code === 'DISPOSED' ? 503 : 500),
  })
}

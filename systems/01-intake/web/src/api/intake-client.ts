import type { z } from 'zod'
import type {
  ApplicationCommand,
  ApplicationView,
  CommandResponse,
  CreateApplicationRequest,
  DemoActionResponse,
  HealthResponse,
  ReviewerCommand,
} from '../../../shared/api-contract'
import {
  ApplicationCommandSchema,
  ApplicationViewSchema,
  CommandResponseSchema,
  CreateApplicationRequestSchema,
  DemoActionResponseSchema,
  HealthResponseSchema,
  ReviewerCommandSchema,
  ReviewerQueueSchema,
} from '../../../shared/api-contract'
import {
  APPLICANT_API_HEADERS,
  createHttpClient,
  type HttpRequestOptions,
  REVIEWER_API_HEADERS,
} from './http'

export type ReviewerQueue = z.infer<typeof ReviewerQueueSchema>

const publicHttp = createHttpClient()
const applicantHttp = createHttpClient({ headers: APPLICANT_API_HEADERS })
const reviewerHttp = createHttpClient({ headers: REVIEWER_API_HEADERS })

function applicationPath(applicationId: string, reviewer = false): string {
  if (applicationId.trim().length === 0) throw new TypeError('Application id cannot be empty')
  const prefix = reviewer ? '/api/reviewer/applications' : '/api/applications'
  return `${prefix}/${encodeURIComponent(applicationId)}`
}

export function createApplication(
  input: CreateApplicationRequest,
  options?: HttpRequestOptions,
): Promise<ApplicationView> {
  return applicantHttp.post(
    '/api/applications',
    CreateApplicationRequestSchema.parse(input),
    ApplicationViewSchema,
    options,
  )
}

export function getApplication(
  applicationId: string,
  options?: HttpRequestOptions,
): Promise<ApplicationView> {
  return applicantHttp.get(applicationPath(applicationId), ApplicationViewSchema, options)
}

export function sendApplicationCommand(
  applicationId: string,
  command: ApplicationCommand,
  options?: HttpRequestOptions,
): Promise<CommandResponse> {
  return applicantHttp.post(
    `${applicationPath(applicationId)}/commands`,
    ApplicationCommandSchema.parse(command),
    CommandResponseSchema,
    options,
  )
}

export function listReviewerApplications(options?: HttpRequestOptions): Promise<ReviewerQueue> {
  return reviewerHttp.get('/api/reviewer/applications', ReviewerQueueSchema, options)
}

export function getReviewerApplication(
  applicationId: string,
  options?: HttpRequestOptions,
): Promise<ApplicationView> {
  return reviewerHttp.get(applicationPath(applicationId, true), ApplicationViewSchema, options)
}

export function sendReviewerCommand(
  applicationId: string,
  command: ReviewerCommand,
  options?: HttpRequestOptions,
): Promise<CommandResponse> {
  return reviewerHttp.post(
    `${applicationPath(applicationId, true)}/commands`,
    ReviewerCommandSchema.parse(command),
    CommandResponseSchema,
    options,
  )
}

export function seedDemo(options?: HttpRequestOptions): Promise<DemoActionResponse> {
  return reviewerHttp.post('/api/demo/seed', {}, DemoActionResponseSchema, options)
}

export function resetDemo(options?: HttpRequestOptions): Promise<DemoActionResponse> {
  return reviewerHttp.post('/api/demo/reset', {}, DemoActionResponseSchema, options)
}

export function getHealth(options?: HttpRequestOptions): Promise<HealthResponse> {
  return publicHttp.get('/health', HealthResponseSchema, options)
}

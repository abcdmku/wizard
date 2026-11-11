import type { IncomingHttpHeaders } from 'node:http'
import {
  type ApplicantViewer,
  type ReviewerViewer,
  type Viewer,
  ViewerScopeSchema,
} from '../../shared/common.js'
import { IntakeHttpError } from './errors.js'

export const DEMO_TENANT_ID = 'demo-grants'
export const DEMO_APPLICANT_TOKEN = 'intake-applicant-demo'
export const DEMO_REVIEWER_TOKEN = 'intake-reviewer-demo'
export const DEMO_APPLICANT_ID = 'demo-applicant'
export const DEMO_REVIEWER_ID = 'demo-reviewer'
export const DEMO_WEST_TENANT_ID = 'demo-grants-west'
export const DEMO_WEST_APPLICANT_TOKEN = 'intake-applicant-west-demo'
export const DEMO_WEST_REVIEWER_TOKEN = 'intake-reviewer-west-demo'
export const DEMO_WEST_APPLICANT_ID = 'demo-applicant-west'
export const DEMO_WEST_REVIEWER_ID = 'demo-reviewer-west'

type DemoRole = Viewer['role']

function oneHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function unauthorized(message: string): never {
  throw new IntakeHttpError({ code: 'UNAUTHORIZED', message, statusCode: 401 })
}

function forbidden(message: string): never {
  throw new IntakeHttpError({ code: 'FORBIDDEN', message, statusCode: 403 })
}

function tokenViewer(authorization: string | undefined): Viewer | undefined {
  if (authorization === undefined) return undefined
  const match = /^Bearer[ \t]+([^ \t]+)$/i.exec(authorization)
  const token = match?.[1]
  if (token === DEMO_APPLICANT_TOKEN) {
    return { role: 'applicant', tenantId: DEMO_TENANT_ID, applicantId: DEMO_APPLICANT_ID }
  }
  if (token === DEMO_REVIEWER_TOKEN) {
    return { role: 'reviewer', tenantId: DEMO_TENANT_ID, reviewerId: DEMO_REVIEWER_ID }
  }
  if (token === DEMO_WEST_APPLICANT_TOKEN) {
    return {
      role: 'applicant',
      tenantId: DEMO_WEST_TENANT_ID,
      applicantId: DEMO_WEST_APPLICANT_ID,
    }
  }
  if (token === DEMO_WEST_REVIEWER_TOKEN) {
    return {
      role: 'reviewer',
      tenantId: DEMO_WEST_TENANT_ID,
      reviewerId: DEMO_WEST_REVIEWER_ID,
    }
  }
  return undefined
}

export function requireDemoScope(
  headers: IncomingHttpHeaders,
  expectedRole: 'applicant',
): ApplicantViewer
export function requireDemoScope(
  headers: IncomingHttpHeaders,
  expectedRole: 'reviewer',
): ReviewerViewer
export function requireDemoScope(headers: IncomingHttpHeaders, expectedRole: DemoRole): Viewer {
  const authorization = oneHeader(headers.authorization)
  const viewer = tokenViewer(authorization)
  if (viewer === undefined) unauthorized('A valid bearer token is required')
  if (viewer.role !== expectedRole) forbidden(`This route requires the ${expectedRole} role`)

  const tenantId = oneHeader(headers['x-tenant-id'])
  if (tenantId !== viewer.tenantId) forbidden('The authenticated tenant does not match the request')

  return ViewerScopeSchema.parse(viewer)
}

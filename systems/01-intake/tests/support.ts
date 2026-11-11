import { z } from 'zod'
import {
  DEMO_WEST_APPLICANT_TOKEN,
  DEMO_WEST_REVIEWER_TOKEN,
  DEMO_WEST_TENANT_ID,
} from '../api/http/auth'
import {
  type ApplicationCommand,
  type ApplicationView,
  ApplicationViewSchema,
  type CommandResponse,
  CommandResponseSchema,
  CreateApplicationRequestSchema,
} from '../shared/api-contract'
import type { DurableVersion } from '../shared/common'

export const baseUrl = process.env.INTAKE_API_URL ?? 'http://127.0.0.1:4310'
export const tenant = process.env.INTAKE_TENANT_ID ?? 'demo-grants'
export const applicantToken = process.env.INTAKE_APPLICANT_TOKEN ?? 'intake-applicant-demo'
export const reviewerToken = process.env.INTAKE_REVIEWER_TOKEN ?? 'intake-reviewer-demo'
export const westTenant = DEMO_WEST_TENANT_ID
export const westApplicantToken = DEMO_WEST_APPLICANT_TOKEN
export const westReviewerToken = DEMO_WEST_REVIEWER_TOKEN
export const createBody = JSON.parse(
  process.env.INTAKE_CREATE_BODY ?? '{"applicantName":"Ada Lovelace"}',
)

export interface Fixture {
  readonly id: string
  readonly applicantToken: string
  readonly reviewerToken: string
  readonly tenant: string
  view: ApplicationView
}

export function headers(token = applicantToken, tenantId = tenant): HeadersInit {
  return {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'x-tenant-id': tenantId,
  }
}

export function request(
  path: string,
  init: RequestInit = {},
  token?: string,
  tenantId?: string,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...headers(token, tenantId), ...(init.headers ?? {}) },
  })
}

export async function body(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json()
  const parsed = z.record(z.string(), z.unknown()).safeParse(value)
  if (!parsed.success) throw new Error('expected a JSON object')
  return parsed.data
}

export async function view(response: Response): Promise<ApplicationView> {
  const parsed = ApplicationViewSchema.safeParse(await response.json())
  if (!parsed.success) throw new Error(`invalid application view: ${parsed.error.message}`)
  return parsed.data
}

function readId(value: Record<string, unknown>): string {
  const data = z.record(z.string(), z.unknown()).safeParse(value.data)
  const id = [value.id, value.applicationId, data.success ? data.data.id : undefined].find(
    (candidate): candidate is string => typeof candidate === 'string',
  )
  if (!id) throw new Error(`response did not include an application id: ${JSON.stringify(value)}`)
  return id
}

export interface FixtureOptions {
  readonly applicantToken?: string
  readonly reviewerToken?: string
  readonly tenant?: string
}

export async function createFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const auth = {
    applicantToken: options.applicantToken ?? applicantToken,
    reviewerToken: options.reviewerToken ?? reviewerToken,
    tenant: options.tenant ?? tenant,
  }
  CreateApplicationRequestSchema.parse(createBody)
  const created = await request(
    '/api/applications',
    {
      method: 'POST',
      body: JSON.stringify(createBody),
    },
    auth.applicantToken,
    auth.tenant,
  )
  if (created.status !== 201)
    throw new Error(`create failed: ${created.status} ${await created.text()}`)
  const id = readId(await body(created))
  const loaded = await request(
    `/api/applications/${encodeURIComponent(id)}`,
    {},
    auth.applicantToken,
    auth.tenant,
  )
  if (loaded.status !== 200) throw new Error(`read failed: ${loaded.status}`)
  return { id, ...auth, view: await view(loaded) }
}

export function version(application: ApplicationView): DurableVersion {
  return { epoch: application.workflow.epoch, seq: application.workflow.seq }
}

export function commandBody(
  fixture: Fixture,
  commandId: string,
  type: ApplicationCommand['type'],
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return { commandId, type, expectedVersion: version(fixture.view), ...fields }
}

export async function command(
  fixture: Fixture,
  commandId: string,
  type: ApplicationCommand['type'],
  fields: Record<string, unknown> = {},
): Promise<CommandResponse> {
  const response = await request(
    `/api/applications/${encodeURIComponent(fixture.id)}/commands`,
    {
      method: 'POST',
      body: JSON.stringify(commandBody(fixture, commandId, type, fields)),
    },
    fixture.applicantToken,
    fixture.tenant,
  )
  const result = CommandResponseSchema.parse(await response.json())
  if (result.application) fixture.view = result.application
  return result
}

export async function waitFor(check: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`condition did not become true within ${timeoutMs}ms`)
}

export async function advanceApplicantToBusinessProfile(fixture: Fixture): Promise<void> {
  const send = async (type: ApplicationCommand['type'], fields: Record<string, unknown> = {}) => {
    const result = await command(fixture, `business-${type}-${Date.now()}`, type, fields)
    if (!result.ok) throw new Error(`business fixture command failed: ${result.code}`)
  }
  await send('start')
  await send('setInput', {
    step: 'consent',
    patch: {
      consentToPreviousApplication: false,
      consentToRegistry: true,
      contactEmail: 'restart@example.test',
    },
  })
  await send('next')
  await waitFor(async () => {
    fixture.view = await view(await request(`/api/applications/${fixture.id}`))
    return fixture.view.workflow.current === 'businessProfile'
  })
  await send('setInput', {
    step: 'businessProfile',
    patch: {
      legalName: 'Restart Recovery LLC',
      registrationNumber: 'RR-001',
      legalStructure: 'incorporated',
      annualRevenue: 250_000,
      requestedAmount: 50_000,
      tradingMonths: 48,
      employeeCount: 8,
      postalCode: '60601',
      experiencedHardship: false,
    },
  })
}

export async function advanceStandardApplicantToRisk(fixture: Fixture): Promise<void> {
  const send = async (type: ApplicationCommand['type'], fields: Record<string, unknown> = {}) => {
    const result = await command(fixture, `standard-${type}-${Date.now()}`, type, fields)
    if (!result.ok) throw new Error(`standard fixture command failed: ${result.code}`)
    fixture.view = await view(await request(`/api/applications/${fixture.id}`))
  }
  const waitForStep = async (step: string): Promise<void> => {
    await waitFor(async () => {
      fixture.view = await view(await request(`/api/applications/${fixture.id}`))
      return fixture.view.workflow.current === step
    })
  }

  await send('start')
  await send('setInput', {
    step: 'consent',
    patch: {
      consentToPreviousApplication: false,
      consentToRegistry: true,
      contactEmail: 'worker@example.test',
    },
  })
  await send('next')
  await waitForStep('businessProfile')
  await send('setInput', {
    step: 'businessProfile',
    patch: {
      legalName: 'Worker Recovery LLC',
      registrationNumber: 'WR-001',
      legalStructure: 'incorporated',
      annualRevenue: 250_000,
      requestedAmount: 50_000,
      tradingMonths: 48,
      employeeCount: 8,
      postalCode: '60601',
      experiencedHardship: false,
    },
  })
  await send('next')
  await waitForStep('beneficialOwners')
  await send('setInput', {
    step: 'beneficialOwners',
    patch: { owners: [{ id: 'worker-owner', name: 'Ada Lovelace', ownershipPercent: 100 }] },
  })
  await send('next')
  await waitForStep('standardFinancials')
  await send('setInput', {
    step: 'standardFinancials',
    patch: { annualExpenses: 120_000, cashOnHand: 30_000, fiscalYearEnd: '2025-12-31' },
  })
  await send('next')
  await waitForStep('documents')
  await send('setInput', {
    step: 'documents',
    patch: {
      documents: [
        {
          id: 'worker-doc',
          name: 'financials.pdf',
          category: 'financial',
          sizeBytes: 1024,
          uploadedAt: new Date().toISOString(),
        },
      ],
    },
  })
  await send('next')
  await waitForStep('review')
  await send('setInput', {
    step: 'review',
    patch: { confirmed: true, signatureName: 'Ada Lovelace' },
  })
  await send('next')
}

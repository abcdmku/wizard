import type { ApplicationCommand, ApplicationView } from '../shared/api-contract.js'
import type { ApplicantViewer, IntakeViewStepId, ReviewerViewer } from '../shared/common.js'
import type { IntakeDatabase } from './db/index.js'
import { DEMO_APPLICANT_ID } from './http/auth.js'
import { IntakeHttpError } from './http/errors.js'
import type { IntakeRuntimeService } from './runtime/index.js'

export const DEMO_APPLICATION_ID = 'demo-application'
const DEMO_APPLICATION_NAME = 'Ada Lovelace'
const DEFAULT_TIMEOUT_MS = 20_000
const POLL_MS = 250

interface SeedManualReviewDemoOptions {
  readonly database: IntakeDatabase
  readonly runtime: IntakeRuntimeService
  readonly scope: ReviewerViewer
  readonly timeoutMs?: number
}

export async function seedManualReviewDemo(
  options: SeedManualReviewDemoOptions,
): Promise<ApplicationView> {
  await ensureDemoApplication(options.database, options.scope)
  const applicant: ApplicantViewer = {
    role: 'applicant',
    tenantId: options.scope.tenantId,
    applicantId: DEMO_APPLICANT_ID,
  }
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  while (Date.now() <= deadline) {
    const application = await project(options.runtime, applicant)
    if (application === undefined) {
      await wait(POLL_MS)
      continue
    }
    if (application.status === 'awaiting-reviewer') return application
    if (application.status === 'approved' || application.status === 'rejected') {
      throw seedError('DEMO_ALREADY_DECIDED', 'Reset the demo before seeding it again', 409)
    }
    await advanceCurrentView(options.runtime, applicant, application)
    await wait(POLL_MS)
  }
  throw seedError(
    'DEMO_SEED_TIMEOUT',
    'The demo risk worker did not reach manual review in time',
    503,
  )
}

async function advanceCurrentView(
  runtime: IntakeRuntimeService,
  applicant: ApplicantViewer,
  application: ApplicationView,
): Promise<boolean> {
  const current = application.workflow.current
  if (current === null || !isViewStep(current)) return false
  const input = demoInput(current)
  if (input === undefined) return false
  const inputAccepted = await dispatch(runtime, applicant, {
    type: 'setInput',
    step: current,
    patch: input,
    commandId: `demo:${current}:input`,
  })
  if (!inputAccepted) return false
  const nextAccepted = await dispatch(runtime, applicant, {
    type: 'next',
    commandId: `demo:${current}:next`,
  })
  return nextAccepted
}

function demoInput(step: IntakeViewStepId): Record<string, unknown> | undefined {
  switch (step) {
    case 'consent':
      return {
        consentToPreviousApplication: true,
        consentToRegistry: true,
        contactEmail: 'ada@demo.openwizard.local',
      }
    case 'businessProfile':
      return {
        legalName: 'Analytical Engines Demo Inc',
        registrationNumber: 'IL-DEMO-1843',
        legalStructure: 'incorporated',
        annualRevenue: 300_000,
        requestedAmount: 80_000,
        tradingMonths: 12,
        employeeCount: 2,
        postalCode: '60601',
        experiencedHardship: false,
      }
    case 'beneficialOwners':
      return { owners: [{ id: 'demo-owner', name: 'Ada Lovelace', ownershipPercent: 100 }] }
    case 'standardFinancials':
      return { annualExpenses: 220_000, cashOnHand: 25_000, fiscalYearEnd: '2026-12-31' }
    case 'documents':
      return {
        documents: [
          {
            id: 'demo-financials',
            name: 'demo-financials.pdf',
            category: 'financial',
            sizeBytes: 24_000,
            uploadedAt: '2026-08-23T10:00:00.000Z',
          },
        ],
      }
    case 'review':
      return { confirmed: true, signatureName: 'Ada Lovelace' }
    default:
      return undefined
  }
}

function isViewStep(
  step: NonNullable<ApplicationView['workflow']['current']>,
): step is IntakeViewStepId {
  switch (step) {
    case 'consent':
    case 'businessProfile':
    case 'beneficialOwners':
    case 'standardFinancials':
    case 'hardshipEvidence':
    case 'appeal':
    case 'documents':
    case 'review':
      return true
    default:
      return false
  }
}

async function dispatch(
  runtime: IntakeRuntimeService,
  applicant: ApplicantViewer,
  command: ApplicationCommand,
): Promise<boolean> {
  const result = await runtime.dispatch(DEMO_APPLICATION_ID, applicant, command)
  if (!result.ok) {
    if (transientCode(result.code)) return false
    throw seedError(result.code, 'The demo workflow command was not accepted', 409)
  }
  if (!result.result.ok) {
    if (transientCode(result.result.code)) return false
    throw seedError(result.result.code, 'The demo workflow could not advance', 409)
  }
  return true
}

function transientCode(code: string): boolean {
  return (
    code === 'CAS_CONFLICT' ||
    code === 'COMMAND_PENDING' ||
    code === 'LEASE_BUSY' ||
    code === 'LEASE_LOST' ||
    code === 'STALE'
  )
}

async function project(
  runtime: IntakeRuntimeService,
  applicant: ApplicantViewer,
): Promise<ApplicationView | undefined> {
  const result = await runtime.project(DEMO_APPLICATION_ID, applicant)
  if (!result.ok) {
    if (transientCode(result.code)) return undefined
    throw seedError(result.code, result.message, 503)
  }
  return result.application
}

async function ensureDemoApplication(
  database: IntakeDatabase,
  scope: ReviewerViewer,
): Promise<void> {
  if ((await database.applications.get(scope.tenantId, DEMO_APPLICATION_ID)) !== null) return
  try {
    await database.applications.create({
      id: DEMO_APPLICATION_ID,
      tenantId: scope.tenantId,
      applicantId: DEMO_APPLICANT_ID,
      applicantName: DEMO_APPLICATION_NAME,
    })
  } catch (error) {
    const concurrent = await database.applications.get(scope.tenantId, DEMO_APPLICATION_ID)
    if (concurrent === null) throw error
  }
}

function seedError(code: string, message: string, statusCode: number): IntakeHttpError {
  return new IntakeHttpError({ code, message, statusCode })
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

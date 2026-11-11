import { createTestScheduler } from '@openwizard/core/testing'
import type {
  ApplicantViewer,
  IntakeContext,
  PrefillResult,
  ReviewerViewer,
} from '../../shared/index.js'
import type { IntakeDeps } from './ports.js'
import { intakeWizard } from './wizard.js'

export const context: IntakeContext = {
  applicationId: 'app-1',
  tenantId: 'tenant-1',
  applicantId: 'person-1',
  applicantName: 'Ada Lovelace',
  changeRequestCount: 0,
}

export const prefill: PrefillResult = {
  registryProfile: {
    legalName: 'Analytical Engines Inc',
    registrationNumber: 'REG-1843',
    legalStructure: 'incorporated',
    postalCode: '60601',
    verified: true,
  },
  previousApplication: {
    legalName: 'Analytical Engines Inc',
    requestedAmount: 50_000,
    submittedAt: '2026-08-20T10:00:00.000Z',
  },
  fetchedAt: '2026-08-23T10:00:00.000Z',
}

export const deps: IntakeDeps = {
  prefill: async () => prefill,
  enqueueRisk: async (_applicationId, _input, idempotencyKey) => idempotencyKey,
}

export const applicant: ApplicantViewer = {
  role: 'applicant',
  tenantId: 'tenant-1',
  applicantId: 'person-1',
}
export const reviewer: ReviewerViewer = {
  role: 'reviewer',
  tenantId: 'tenant-1',
  reviewerId: 'reviewer-1',
}

export function makeRun() {
  return intakeWizard.create(context, {
    deps,
    scheduler: createTestScheduler({ now: 1_000 }),
    instanceId: 'intake-1',
  })
}

export async function reachReview() {
  const run = makeRun()
  await run.start()
  await run.setInput('consent', {
    consentToPreviousApplication: true,
    consentToRegistry: true,
    contactEmail: 'ada@example.test',
  })
  await run.next()
  await run.awaitOutcome()
  await run.setInput('businessProfile', {
    annualRevenue: 500_000,
    tradingMonths: 24,
    employeeCount: 8,
    experiencedHardship: false,
  })
  await run.next()
  await run.setInput('beneficialOwners', {
    owners: [
      {
        id: 'owner-1',
        name: 'Ada Lovelace',
        ownershipPercent: 100,
        dateOfBirth: '1815-12-10',
      },
    ],
  })
  await run.next()
  await run.awaitOutcome()
  await run.setInput('standardFinancials', {
    annualExpenses: 240_000,
    cashOnHand: 80_000,
    fiscalYearEnd: '2026-12-31',
  })
  await run.next()
  await run.setInput('documents', {
    documents: [
      {
        id: 'doc-1',
        name: 'accounts.pdf',
        category: 'financial',
        sizeBytes: 1_024,
        uploadedAt: '2026-08-23T10:02:00.000Z',
      },
    ],
  })
  await run.next()
  return run
}

export async function reachRiskWait() {
  const run = await reachReview()
  await run.setInput('review', { confirmed: true, signatureName: 'Ada Lovelace' })
  await run.next()
  await run.awaitOutcome()
  return run
}

/** Risk asks for a person, and the reviewer sends the business profile back to the applicant. */
export async function reachChangeRequest() {
  const run = await reachRiskWait()
  await run.send('risk.completed', {
    jobId: 'risk:app-1:0',
    outcome: 'manual-review',
    score: 60,
    reasons: ['A reviewer must confirm the recovery evidence.'],
    completedAt: '2026-08-23T10:03:00.000Z',
  })
  await run.awaitOutcome()
  await run.send('review.decided', changeRequest)
  await run.awaitOutcome()
  return run
}

export const changeRequest = {
  decision: 'request-changes' as const,
  reviewerId: 'reviewer-1',
  reason: 'Update the business revenue.',
  requestedFields: ['businessProfile.annualRevenue'],
  decidedAt: '2026-08-23T10:04:00.000Z',
}

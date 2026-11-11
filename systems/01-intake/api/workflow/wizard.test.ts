import { inspect } from '@openwizard/core/inspect'
import { createTestScheduler } from '@openwizard/core/testing'
import { describe, expect, it } from 'vitest'
import {
  ApplicationViewSchema,
  type IntakeContext,
  type PrefillResult,
  type Viewer,
} from '../../shared/index.js'
import { authorizeIntakeCommand } from './access.js'
import { changeRequestTarget } from './invalidation.js'
import { migrateIntakeSnapshot } from './migration.js'
import type { IntakeDeps } from './ports.js'
import { applicantProjection, reviewerProjection } from './projections.js'
import { intakeWizard } from './wizard.js'

const context: IntakeContext = {
  applicationId: 'app-1',
  tenantId: 'tenant-1',
  applicantId: 'person-1',
  applicantName: 'Ada Lovelace',
  changeRequestCount: 0,
}

const prefill: PrefillResult = {
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

const deps: IntakeDeps = {
  prefill: async () => prefill,
  enqueueRisk: async (_applicationId, _input, idempotencyKey) => idempotencyKey,
}

const applicant: Viewer = {
  role: 'applicant',
  tenantId: 'tenant-1',
  applicantId: 'person-1',
}
const reviewer: Viewer = {
  role: 'reviewer',
  tenantId: 'tenant-1',
  reviewerId: 'reviewer-1',
}

function makeRun() {
  return intakeWizard.create(context, {
    deps,
    scheduler: createTestScheduler({ now: 1_000 }),
    instanceId: 'intake-1',
  })
}

async function reachReview() {
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

async function reachRiskWait() {
  const run = await reachReview()
  await run.setInput('review', { confirmed: true, signatureName: 'Ada Lovelace' })
  await run.next()
  await run.awaitOutcome()
  return run
}

describe('conditional intake wizard', () => {
  it('initializes the profile from durable prefill and takes the incorporated branch', async () => {
    const run = makeRun()
    await run.start()
    await run.setInput('consent', {
      consentToPreviousApplication: true,
      consentToRegistry: true,
      contactEmail: 'ada@example.test',
    })
    await run.next()
    await run.awaitOutcome()

    expect(run.getState().current).toBe('businessProfile')
    expect(run.getState().steps.businessProfile.input).toMatchObject({
      legalName: 'Analytical Engines Inc',
      requestedAmount: 50_000,
      legalStructure: 'incorporated',
    })
    await run.setInput('businessProfile', {
      annualRevenue: 500_000,
      tradingMonths: 24,
      employeeCount: 8,
      experiencedHardship: false,
    })
    await run.next()
    expect(run.getState().current).toBe('beneficialOwners')
    run.dispose()
  })

  it('completes an automatic approval and keeps applicant risk internals private', async () => {
    const run = await reachRiskWait()
    expect(run.getState().steps.awaitRisk.status).toBe('active')
    await run.send('risk.completed', {
      jobId: 'risk:app-1:0',
      outcome: 'approved',
      score: 91,
      reasons: ['private underwriting reason'],
      completedAt: '2026-08-23T10:03:00.000Z',
    })
    await run.awaitOutcome()
    expect(run.getState().output).toEqual({
      applicationId: 'app-1',
      decision: 'approved',
      source: 'automatic',
    })

    const applicantJson = JSON.stringify(run.project(applicantProjection, applicant))
    expect(applicantJson).not.toContain('private underwriting reason')
    expect(applicantJson).not.toContain('"score"')
    expect(applicantJson).not.toContain('riskJobId')
    expect(applicantJson).not.toContain('reviewerId')
    const reviewerJson = JSON.stringify(run.project(reviewerProjection, reviewer))
    expect(reviewerJson).toContain('private underwriting reason')
    expect(reviewerJson).toContain('"score":91')
    expect(reviewerJson).toContain('Ada Lovelace')
    expect(reviewerJson).toContain('"ownershipPercent":100')
    expect(reviewerJson).toContain('accounts.pdf')
    expect(reviewerJson).not.toContain('ada@example.test')
    expect(reviewerJson).not.toContain('1815-12-10')
    const reviewerView = run.project(reviewerProjection, reviewer)
    if (reviewerView.access !== 'granted') throw new Error('reviewer projection was denied')
    expect(() =>
      ApplicationViewSchema.parse({
        id: 'app-1',
        applicantName: reviewerView.applicantName,
        createdAt: '2026-08-23T10:00:00.000Z',
        updatedAt: '2026-08-23T10:03:00.000Z',
        status: reviewerView.status,
        workflow: reviewerView.workflow,
      }),
    ).not.toThrow()
    run.dispose()
  })

  it('skips the owner branch for sole proprietors and reaches financial review', async () => {
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
      legalStructure: 'sole-proprietor',
      annualRevenue: 500_000,
      tradingMonths: 24,
      employeeCount: 8,
      experiencedHardship: false,
    })
    await run.next()
    await run.awaitOutcome()

    expect(run.getState().current).toBe('standardFinancials')
    expect(run.getState().steps.beneficialOwners.status).toBe('skipped')
    expect(run.getState().steps.eligibility.output?.path).toBe('standard')
    run.dispose()
  })

  it('drops and denies a reviewer decision before manual review is active', async () => {
    const run = makeRun()
    await run.start()
    const payload = {
      decision: 'approve' as const,
      reviewerId: 'reviewer-1',
      reason: 'Premature decision should not be retained.',
      requestedFields: [],
      decidedAt: '2026-08-23T10:01:00.000Z',
    }
    expect(
      authorizeIntakeCommand({
        state: run.getState(),
        command: { type: 'send', event: 'review.decided', payload },
        scope: reviewer,
      }),
    ).toBe(false)
    await expect(run.send('review.decided', payload)).resolves.toEqual({
      ok: false,
      reason: 'dropped',
      code: 'NOT_ACTIVE',
      message: "no step is waiting for 'review.decided' and unmatched events are not buffered",
    })
    expect(run.getState().inbox).toEqual([])
    run.dispose()
  })

  it('routes requested field changes to the earliest view and reruns risk', async () => {
    const run = await reachRiskWait()
    await run.send('risk.completed', {
      jobId: 'risk:app-1:0',
      outcome: 'manual-review',
      score: 60,
      reasons: ['A reviewer must confirm the recovery evidence.'],
      completedAt: '2026-08-23T10:03:00.000Z',
    })
    await run.awaitOutcome()
    expect(run.getState().steps.manualReview.status).toBe('active')
    expect(
      authorizeIntakeCommand({
        state: run.getState(),
        command: {
          type: 'send',
          event: 'review.decided',
          payload: {
            decision: 'request-changes',
            reviewerId: 'reviewer-1',
            reason: 'Update the business revenue.',
            requestedFields: ['businessProfile.annualRevenue'],
            decidedAt: '2026-08-23T10:04:00.000Z',
          },
        },
        scope: reviewer,
      }),
    ).toBe(true)

    await run.send('review.decided', {
      decision: 'request-changes',
      reviewerId: 'reviewer-1',
      reason: 'Update the business revenue.',
      requestedFields: ['businessProfile.annualRevenue'],
      decidedAt: '2026-08-23T10:04:00.000Z',
    })
    await run.awaitOutcome()
    expect(run.getState().current).toBe('businessProfile')
    expect(run.getState().context.changeRequestCount).toBe(1)
    expect(changeRequestTarget(['beneficialOwners.owners.0.name'])).toBe('beneficialOwners')

    await run.setInput('businessProfile', { annualRevenue: 600_000 })
    await run.next()
    expect(run.getState().current).toBe('beneficialOwners')
    await run.next()
    await run.awaitOutcome()
    expect(run.getState().current).toBe('standardFinancials')
    await run.next()
    expect(run.getState().current).toBe('documents')
    await run.next()
    expect(run.getState().current).toBe('review')
    await run.next()
    await run.awaitOutcome()

    expect(run.getState().steps.awaitRisk.status).toBe('active')
    expect(run.getState().steps.queueRisk.output).toBe('risk:app-1:1')
    expect(run.getState().steps.queueRisk.runId).toBe(2)

    const second = {
      outcome: 'manual-review' as const,
      score: 61,
      reasons: ['A reviewer must confirm the updated revenue.'],
      completedAt: '2026-08-23T10:06:00.000Z',
    }
    await run.send('risk.completed', { ...second, jobId: 'risk:app-1:0' })
    expect(run.getState().steps.awaitRisk.status).toBe('active')
    await run.send('risk.completed', { ...second, jobId: 'risk:app-1:1' })
    await run.awaitOutcome()
    expect(run.getState().steps.manualReview.status).toBe('active')
    await run.send('review.decided', {
      decision: 'approve',
      reviewerId: 'reviewer-1',
      reason: 'The updated revenue supports the request.',
      requestedFields: [],
      decidedAt: '2026-08-23T10:07:00.000Z',
    })
    await run.awaitOutcome()
    expect(run.getState().status).toBe('done')
    expect(run.getState().output).toEqual({
      applicationId: 'app-1',
      decision: 'approved',
      source: 'reviewer',
    })
    expect(run.getState().context).toEqual({
      ...context,
      changeRequestCount: 1,
      result: run.getState().output,
      prefill,
      documents: run.getState().steps.documents.output,
      review: run.getState().steps.review.output,
    })
    run.dispose()
  })

  it('queues risk only after the review is signed again when an earlier answer changes', async () => {
    const run = await reachReview()
    expect(run.getState().current).toBe('review')
    await run.back()
    expect(run.getState().current).toBe('documents')
    await run.setInput('documents', {
      documents: [
        {
          id: 'doc-2',
          name: 'updated-accounts.pdf',
          category: 'financial',
          sizeBytes: 2_048,
          uploadedAt: '2026-08-23T10:02:30.000Z',
        },
      ],
    })
    await run.next()
    await run.whenIdle()
    expect(run.getState().current).toBe('review')
    expect(['idle', 'skipped']).toContain(run.getState().steps.queueRisk.status)

    for (const view of ['documents', 'standardFinancials', 'beneficialOwners', 'businessProfile']) {
      await run.back()
      expect(run.getState().current).toBe(view)
    }
    await run.setInput('businessProfile', { annualRevenue: 700_000 })
    expect(await run.invalidate('eligibility')).toMatchObject({ ok: true })
    await run.next()
    expect(run.getState().current).toBe('beneficialOwners')
    await run.next()
    await run.awaitOutcome()
    expect(run.getState().current).toBe('standardFinancials')
    await run.next()
    expect(run.getState().current).toBe('documents')
    await run.next()
    await run.whenIdle()
    expect(run.getState().current).toBe('review')
    expect(['idle', 'skipped']).toContain(run.getState().steps.queueRisk.status)

    await run.setInput('review', { confirmed: true, signatureName: 'Ada Lovelace' })
    await run.next()
    await run.awaitOutcome()
    expect(run.getState().steps.awaitRisk.status).toBe('active')
    expect(run.getState().steps.queueRisk.output).toBe('risk:app-1:0')
    run.dispose()
  })

  it('passes every hand-off through needs and declares what each step is for', () => {
    const manifest = inspect(intakeWizard)
    expect(manifest.description).toContain('grant application')
    expect(manifest.nodes.filter((node) => node.description === undefined)).toEqual([])
    expect(manifest.warnings.map((warning) => warning.code).sort()).toEqual([
      ...Array.from({ length: 8 }, () => 'NAV_CYCLE'),
    ])
  })

  it('resumes a version 1 snapshot that still carries hook-written context', async () => {
    const run = await reachRiskWait()
    const snapshot = run.getSnapshot()
    const state = run.getState()
    run.dispose()
    const legacy = {
      ...snapshot,
      wizard: { ...snapshot.wizard, version: 1 },
      state: {
        ...snapshot.state,
        wizard: { ...snapshot.state.wizard, version: 1 },
        context: {
          ...snapshot.state.context,
          consent: state.steps.consent.output,
          businessProfile: state.steps.businessProfile.output,
          beneficialOwners: state.steps.beneficialOwners.output,
          eligibility: state.steps.eligibility.output,
          standardFinancials: state.steps.standardFinancials.output,
          riskJobId: state.steps.queueRisk.output,
        },
      },
    }
    expect(() => intakeWizard.resume(legacy, { deps })).toThrow()
    const resumed = intakeWizard.resume(legacy, { deps, migrate: migrateIntakeSnapshot })
    expect(resumed.getState().context).toEqual(state.context)
    await resumed.send('risk.completed', {
      jobId: 'risk:app-1:0',
      outcome: 'rejected',
      score: 12,
      reasons: ['The request exceeds the supported amount.'],
      completedAt: '2026-08-23T10:03:00.000Z',
    })
    await resumed.awaitOutcome()
    expect(resumed.getState().output).toEqual({
      applicationId: 'app-1',
      decision: 'rejected',
      source: 'automatic',
    })
    resumed.dispose()
  })

  it('returns no application data for a cross-tenant scope', async () => {
    const run = makeRun()
    const other = { ...applicant, tenantId: 'tenant-2' }
    expect(run.project(applicantProjection, other)).toEqual({ access: 'forbidden' })
    run.dispose()
  })
})

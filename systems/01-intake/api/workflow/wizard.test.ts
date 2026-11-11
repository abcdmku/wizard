import { inspect } from '@openwizard/core/inspect'
import { describe, expect, it } from 'vitest'
import { ApplicationViewSchema } from '../../shared/index.js'
import { authorizeIntakeCommand } from './access.js'
import { applicantProjection, reviewerProjection } from './projections.js'
import { applicant, makeRun, reachRiskWait, reviewer } from './wizard.fixtures.js'
import { intakeWizard } from './wizard.js'

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

  it('passes every hand-off through needs and declares what each step is for', () => {
    const manifest = inspect(intakeWizard)
    expect(manifest.description).toContain('grant application')
    expect(manifest.nodes.filter((node) => node.description === undefined)).toEqual([])
    expect(manifest.warnings.map((warning) => warning.code).sort()).toEqual([
      ...Array.from({ length: 8 }, () => 'NAV_CYCLE'),
    ])
  })

  it('returns no application data for a cross-tenant scope', async () => {
    const run = makeRun()
    const other = { ...applicant, tenantId: 'tenant-2' }
    expect(run.project(applicantProjection, other)).toEqual({ access: 'forbidden' })
    run.dispose()
  })
})

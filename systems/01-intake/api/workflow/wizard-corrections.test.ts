import { describe, expect, it } from 'vitest'
import { authorizeIntakeCommand } from './access.js'
import { changeRequestTarget } from './invalidation.js'
import { migrateIntakeSnapshot } from './migration.js'
import { context, deps, prefill, reachReview, reachRiskWait, reviewer } from './wizard.fixtures.js'
import { intakeWizard } from './wizard.js'

describe('conditional intake wizard: corrections and saved runs', () => {
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
})

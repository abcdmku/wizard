import { describe, expect, it } from 'vitest'
import { migrateIntakeSnapshot } from './migration.js'
import { applicantProjection, reviewerProjection } from './projections.js'
import {
  applicant,
  changeRequest,
  deps,
  reachChangeRequest,
  reachRiskWait,
  reviewer,
} from './wizard.fixtures.js'
import { intakeWizard } from './wizard.js'

type ChangeRequestRun = Awaited<ReturnType<typeof reachChangeRequest>>

function applicantView(run: ChangeRequestRun) {
  const view = run.project(applicantProjection, applicant)
  if (view.access !== 'granted') throw new Error('applicant projection was denied')
  return view
}

function reviewerView(run: ChangeRequestRun) {
  const view = run.project(reviewerProjection, reviewer)
  if (view.access !== 'granted') throw new Error('reviewer projection was denied')
  return view
}

const outstanding = {
  reason: changeRequest.reason,
  requestedFields: changeRequest.requestedFields,
  decidedAt: changeRequest.decidedAt,
}

/** The applicant saves a corrected draft, and the runtime invalidates the work after it. */
async function saveCorrection(run: ChangeRequestRun) {
  await run.setInput('businessProfile', { annualRevenue: 600_000, requestedAmount: 40_000 })
  expect(await run.invalidate('beneficialOwners')).toMatchObject({ ok: true })
  expect(run.getState().steps.manualReview.status).toBe('idle')
  expect(run.getState().steps.manualReview.output).toBeUndefined()
}

async function resubmit(run: ChangeRequestRun) {
  for (const view of ['beneficialOwners', 'standardFinancials', 'documents', 'review']) {
    await run.next()
    await run.awaitOutcome()
    expect(run.getState().current).toBe(view)
  }
  await run.next()
  await run.awaitOutcome()
  expect(run.getState().steps.awaitRisk.status).toBe('active')
}

describe('an outstanding change request', () => {
  it('stays in both projections after the applicant saves a corrected draft', async () => {
    const run = await reachChangeRequest()
    expect(applicantView(run).changeRequest).toEqual(outstanding)

    await saveCorrection(run)

    const view = applicantView(run)
    expect(view.changeRequest).toEqual(outstanding)
    expect(view.workflow.context.changeRequestReason).toBe(changeRequest.reason)
    const review = reviewerView(run)
    expect(review.workflow.context.changeRequestReason).toBe(changeRequest.reason)
    expect(review.reviewerDecision).toEqual({ decision: 'request-changes', ...outstanding })
    expect(review.changeRequestCount).toBe(1)
    run.dispose()
  })

  it('keeps the business summary the reviewer queue shows while the profile is reopened', async () => {
    const run = await reachChangeRequest()
    expect(run.getState().current).toBe('businessProfile')
    expect(reviewerView(run).workflow.context).toMatchObject({
      legalName: 'Analytical Engines Inc',
      legalStructure: 'incorporated',
      requestedAmount: 50_000,
    })

    await saveCorrection(run)
    expect(reviewerView(run).workflow.context).toMatchObject({
      legalName: 'Analytical Engines Inc',
      legalStructure: 'incorporated',
      requestedAmount: 40_000,
    })
    run.dispose()
  })

  it('marks the documents step as changes-requested until the reviewer decides again', async () => {
    const run = await reachChangeRequest()
    await saveCorrection(run)
    await run.next()
    await run.next()
    await run.awaitOutcome()
    await run.next()
    expect(run.getState().current).toBe('documents')
    expect(applicantView(run).status).toBe('changes-requested')
    run.dispose()
  })

  it('is still shown to the reviewer on the second look and ends with the next decision', async () => {
    const run = await reachChangeRequest()
    await saveCorrection(run)
    await resubmit(run)
    await run.send('risk.completed', {
      jobId: 'risk:app-1:1',
      outcome: 'manual-review',
      score: 61,
      reasons: ['A reviewer must confirm the updated revenue.'],
      completedAt: '2026-08-23T10:06:00.000Z',
    })
    await run.awaitOutcome()
    expect(run.getState().steps.manualReview.status).toBe('active')
    expect(reviewerView(run).workflow.context.changeRequestReason).toBe(changeRequest.reason)

    await run.send('review.decided', {
      decision: 'approve',
      reviewerId: 'reviewer-1',
      reason: 'The updated revenue supports the request.',
      requestedFields: [],
      decidedAt: '2026-08-23T10:07:00.000Z',
    })
    await run.awaitOutcome()
    expect(run.getState().output).toMatchObject({ decision: 'approved', source: 'reviewer' })
    expect(run.getState().context.changeRequest).toBeUndefined()
    expect(applicantView(run).changeRequest).toBeUndefined()
    expect(applicantView(run).workflow.context.changeRequestReason).toBeUndefined()
    run.dispose()
  })

  it('is carried over from the reviewer decision in a version 1 snapshot', async () => {
    const run = await reachRiskWait()
    const snapshot = run.getSnapshot()
    run.dispose()
    const legacy = {
      ...snapshot,
      wizard: { ...snapshot.wizard, version: 1 },
      state: {
        ...snapshot.state,
        wizard: { ...snapshot.state.wizard, version: 1 },
        context: {
          ...snapshot.state.context,
          changeRequestCount: 1,
          reviewerDecision: changeRequest,
        },
      },
    }
    const resumed = intakeWizard.resume(legacy, { deps, migrate: migrateIntakeSnapshot })
    expect(resumed.getState().context.changeRequest).toEqual(outstanding)
    expect(applicantView(resumed).changeRequest).toEqual(outstanding)
    resumed.dispose()

    const approved = {
      ...legacy,
      state: {
        ...legacy.state,
        context: {
          ...legacy.state.context,
          reviewerDecision: { ...changeRequest, decision: 'approve', requestedFields: [] },
        },
      },
    }
    const plain = intakeWizard.resume(approved, { deps, migrate: migrateIntakeSnapshot })
    expect(plain.getState().context.changeRequest).toBeUndefined()
    plain.dispose()
  })
})

/**
 * The live overlay mapping: a wizard snapshot (state + live children + `explain` phases) and a
 * Mirror's projected `ClientState` (with an exposed nested child) both flatten to the same
 * `StepStatusMap` keyed by `stepKey`, plus the current view.
 */
import { describe, expect, it } from 'vitest'
import { collectStatuses, overlayOf, wizardPhaseReader } from '../src/status'
import { isWizardSource, stepKey } from '../src/types'
import { makeMirror, makeWizard, runToWait, settle } from './fixture'

describe('collectStatuses / overlayOf', () => {
  it('flattens a wizard snapshot with phases from explain(), nested child steps under `pack/…`', async () => {
    const { wizard, sched } = makeWizard()
    await runToWait(wizard)
    // At the wait: ingest / normalize / enrich / gate done, awaitPayment active (waiting).
    const atWait = collectStatuses(wizard.getSnapshot(), wizardPhaseReader(wizard))
    expect(atWait.statuses.form).toEqual({ status: 'done' })
    expect(atWait.statuses.awaitPayment).toEqual({ status: 'active', phase: 'waiting' })
    expect(atWait.statuses.pack).toEqual({ status: 'idle' })
    expect(atWait.current).toBeNull()
    expect(atWait.statuses['pack/count']).toBeUndefined() // child not live yet

    // Resolve the wait → the child flow runs to its end → the `review` view is current.
    await wizard.send('payment.captured', { paymentId: 'p1' })
    await settle()
    await settle()
    const atReview = collectStatuses(wizard.getSnapshot(), wizardPhaseReader(wizard))
    expect(atReview.current).toBe('review')
    expect(atReview.statuses.review).toEqual({ status: 'active', phase: 'waiting' })
    expect(atReview.statuses.pack).toEqual({ status: 'done' })
    expect(atReview.statuses[stepKey(['pack'], 'count')]).toEqual({ status: 'done' })
    expect(atReview.statuses['pack/packed']).toEqual({ status: 'done' })
    sched.flush()
    wizard.dispose()
  })

  it('reads a Mirror frame the same way (phases from the ClientState, exposed child slice included)', async () => {
    const { wizard, mirror } = makeMirror()
    await runToWait(wizard)
    await settle()
    expect(isWizardSource(mirror)).toBe(false)
    const atWait = overlayOf(mirror, mirror.getSnapshot())
    expect(atWait.statuses.awaitPayment).toEqual({ status: 'active', phase: 'waiting' })
    expect(atWait.statuses.gate).toEqual({ status: 'done' })
    await wizard.send('payment.captured', { paymentId: 'p1' })
    await settle()
    await settle()
    const atReview = overlayOf(mirror, mirror.getSnapshot())
    expect(atReview.current).toBe('review')
    expect(atReview.statuses.review).toEqual({ status: 'active', phase: 'waiting' })
    // The projection exposes `pack`'s child with `count`: its status rides in the nested slice.
    expect(atReview.statuses['pack/count']).toEqual({ status: 'done' })
    expect(atReview.statuses['pack/packed']).toEqual({ status: 'done' })
    mirror.dispose()
    wizard.dispose()
  })
})

/**
 * The live overlay mapping: a run snapshot (state + live children + `explain` phases) and a
 * Mirror's projected `ClientState` (with an exposed nested child) both flatten to the same
 * `StepStatusMap` keyed by `stepKey`, plus the current view.
 */
import { describe, expect, it } from 'vitest'
import { collectStatuses, overlayOf, runPhaseReader } from '../src/status'
import { isRunSource, stepKey } from '../src/types'
import { makeMirror, makeRun, runToWait, settle } from './fixture'

describe('collectStatuses / overlayOf', () => {
  it('flattens a run snapshot with phases from explain(), nested child steps under `pack/…`', async () => {
    const { run, sched } = makeRun()
    await runToWait(run)
    // At the wait: ingest / normalize / enrich / gate done, awaitPayment active (waiting).
    const atWait = collectStatuses(run.getSnapshot(), runPhaseReader(run))
    expect(atWait.statuses.form).toMatchObject({ status: 'done' })
    // The attempt rides along once a step has run, for `attempt 2 of 3` on its card.
    expect(atWait.statuses.ingest?.attempt).toBe(1)
    expect(atWait.statuses.pack?.attempt).toBeUndefined()
    expect(atWait.statuses.awaitPayment).toMatchObject({ status: 'active', phase: 'waiting' })
    expect(atWait.statuses.pack).toMatchObject({ status: 'idle' })
    expect(atWait.current).toBeNull()
    expect(atWait.statuses['pack/count']).toBeUndefined() // child not live yet

    // Resolve the wait → the child flow runs to its end → the `review` view is current.
    await run.send('payment.captured', { paymentId: 'p1' })
    await settle()
    await settle()
    const atReview = collectStatuses(run.getSnapshot(), runPhaseReader(run))
    expect(atReview.current).toBe('review')
    expect(atReview.statuses.review).toMatchObject({ status: 'active', phase: 'waiting' })
    expect(atReview.statuses.pack).toMatchObject({ status: 'done' })
    expect(atReview.statuses[stepKey(['pack'], 'count')]).toMatchObject({ status: 'done' })
    expect(atReview.statuses['pack/packed']).toMatchObject({ status: 'done' })
    sched.flush()
    run.dispose()
  })

  it('reads a Mirror frame the same way (phases from the ClientState, exposed child slice included)', async () => {
    const { run, mirror } = makeMirror()
    await runToWait(run)
    await settle()
    expect(isRunSource(mirror)).toBe(false)
    const atWait = overlayOf(mirror, mirror.getSnapshot())
    expect(atWait.statuses.awaitPayment).toMatchObject({ status: 'active', phase: 'waiting' })
    expect(atWait.statuses.gate).toMatchObject({ status: 'done' })
    await run.send('payment.captured', { paymentId: 'p1' })
    await settle()
    await settle()
    const atReview = overlayOf(mirror, mirror.getSnapshot())
    expect(atReview.current).toBe('review')
    expect(atReview.statuses.review).toMatchObject({ status: 'active', phase: 'waiting' })
    // The projection exposes `pack`'s child with `count`: its status rides in the nested slice.
    expect(atReview.statuses['pack/count']).toMatchObject({ status: 'done' })
    expect(atReview.statuses['pack/packed']).toMatchObject({ status: 'done' })
    mirror.dispose()
    run.dispose()
  })
})

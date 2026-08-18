import { createMemoryStore, createWizard, resumeWizard, type Snapshot } from '@openwizard/core'
import { createTestScheduler } from '@openwizard/core/testing'
import { describe, expect, it } from 'vitest'
import { approval, type Deps } from './approval'

const HOUR = 3_600_000
const T0 = 1_700_000_000_000 // "now" of the first process (any epoch ms)
const KEY = 'tenant-a/expense-approval/42'

/** A notifier that answers immediately, or hangs forever (to simulate a crash mid-task). */
function fakeNotifier(mode: 'instant' | 'hang') {
  const state = { mode, calls: 0 }
  const deps: Deps = {
    notifier: {
      requestApproval: (requestId) => {
        state.calls += 1
        if (state.mode === 'hang') return new Promise(() => {}) // never settles
        return Promise.resolve({ ticket: `TCK-${requestId}-${state.calls}` })
      },
    },
  }
  return { deps, state }
}

const settle = () => new Promise<void>((r) => setTimeout(r, 0))
const context = { requestId: '42', amount: 1_250 }

async function load(
  store: ReturnType<typeof createMemoryStore>,
): Promise<Snapshot<typeof approval>> {
  const saved = await store.get(KEY)
  if (saved === null) throw new Error(`nothing stored under ${KEY}`)
  return saved as Snapshot<typeof approval> // a store returns `unknown`; resumeWizard re-validates it
}

describe('04 resume from snapshot', () => {
  it('mid-wait: auto-saved snapshot → crash → resume on a fresh instance → the 48h timeout still fires', async () => {
    const store = createMemoryStore()
    const { deps } = fakeNotifier('instant')

    // Process 1 ─────────────────────────────────────────────────────────────────────────
    const sched1 = createTestScheduler({ now: T0 })
    const first = createWizard(approval, {
      context,
      deps,
      instanceId: 'exp-42',
      store,
      key: KEY,
      autoSave: 'change', // default when a store is given; written after every committed change
      scheduler: sched1,
    })
    await first.start()
    await settle() // the async notify task resolves → the wait step enters
    expect(first.getState().status).toBe('waiting')
    expect(first.getState().steps.awaitDecision).toMatchObject({
      status: 'active',
      deadline: T0 + 48 * HOUR, // absolute: it survives the crash below
    })
    await first.save() // auto-save already wrote; save() makes the test deterministic
    const saved = await load(store)
    expect(saved).toMatchObject({
      v: 1,
      flow: { name: 'expense-approval', version: 1 },
      instanceId: 'exp-42',
      epoch: 0,
      state: { status: 'waiting', active: ['awaitDecision'] },
    })
    expect(Object.keys(saved.state.timers)).toEqual(['wait:awaitDecision'])
    first.dispose() // 💥 the process dies

    // Process 2, three hours later ──────────────────────────────────────────────────────
    const sched2 = createTestScheduler({ now: T0 + 3 * HOUR })
    const resumed = resumeWizard(approval, await store.get(KEY), {
      deps,
      store,
      key: KEY,
      scheduler: sched2,
    })
    expect(resumed.id).toBe('exp-42')
    expect(resumed.epoch).toBe(1) // bumped on every resume
    // Events emitted by the resume itself are in the log (they happened before we could observe).
    expect(resumed.log()[0]).toMatchObject({
      type: 'flow.resumed',
      fromSeq: saved.seq,
      interrupted: [],
    })
    expect(resumed.getState().status).toBe('waiting')
    expect(resumed.getState().steps.notify).toMatchObject({ status: 'done' })
    expect(resumed.getState().steps.awaitDecision.deadline).toBe(T0 + 48 * HOUR)
    expect(sched2.pending()).toBe(1) // the timer was re-armed for the remaining 45h

    sched2.advance(45 * HOUR - 1)
    expect(resumed.getState().status).toBe('waiting')
    sched2.advance(1)
    expect(resumed.getState().steps.awaitDecision).toMatchObject({
      status: 'done',
      output: { event: 'timeout' },
    })
    expect(resumed.getState().status).toBe('done')
    expect(resumed.getState().output).toBe('expired: nobody decided within 48h')
    expect(
      resumed.log().some((e) => e.type === 'timer.fired' && e.timerId === 'wait:awaitDecision'),
    ).toBe(true)

    // The resumed instance keeps persisting under the same key, now with epoch 1.
    await resumed.save()
    expect(await load(store)).toMatchObject({ epoch: 1, state: { status: 'done' } })
    resumed.dispose()

    // A snapshot is plain data: the SAME saved snapshot can be resumed again, e.g. by a replica
    // that receives the decision in time.
    const replica = resumeWizard(approval, saved, {
      deps,
      scheduler: createTestScheduler({ now: T0 + 1 * HOUR }),
    })
    expect(await replica.send('approval.decided', { approved: true, by: 'kim' })).toMatchObject({
      ok: true,
      delivered: ['awaitDecision'],
    })
    expect(replica.getState().status).toBe('done')
    expect(replica.getState().output).toBe('approved by kim')
    replica.dispose()
  })

  it('mid-task: an interrupted run is failed on resume (kind interrupted) and re-run with retry()', async () => {
    const { deps, state } = fakeNotifier('hang')
    const sched1 = createTestScheduler({ now: T0 })
    const first = createWizard(approval, { context, deps, instanceId: 'exp-43', scheduler: sched1 })
    await first.start()
    expect(first.getState().steps.notify).toMatchObject({ status: 'active', attempt: 1 })
    // What a store would hold at this moment (JSON round trip = what any database does).
    const snapshot = JSON.parse(JSON.stringify(first.getSnapshot())) as unknown
    first.dispose() // 💥 crash while the notifier call is in flight

    state.mode = 'instant'
    const resumed = resumeWizard(approval, snapshot, {
      deps,
      scheduler: createTestScheduler({ now: T0 + 60_000 }),
    })
    expect(resumed.epoch).toBe(1)
    expect(resumed.log()[0]).toMatchObject({ type: 'flow.resumed', interrupted: ['notify'] })
    expect(resumed.getState().steps.notify).toMatchObject({
      status: 'failed',
      error: { kind: 'interrupted', code: 'INTERRUPTED' },
    })
    expect(resumed.getState().status).toBe('failed')
    expect(resumed.explain('notify').reasons).toEqual(['failed:interrupted'])

    // The host decides whether the side effect may run again (make it idempotent!) → retry().
    expect(await resumed.retry('notify')).toMatchObject({ ok: true })
    await settle()
    expect(state.calls).toBe(2)
    expect(resumed.getState().steps.notify).toMatchObject({
      status: 'done',
      output: { ticket: 'TCK-42-2' },
    })
    expect(resumed.getState().status).toBe('waiting')
    expect(await resumed.send('approval.decided', { approved: false, by: 'lee' })).toMatchObject({
      ok: true,
    })
    expect(resumed.getState().output).toBe('rejected by lee')
    resumed.dispose()
  })
})

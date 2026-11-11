/** Remote mapped child commands preserve item selection and draft state across resume. */
import { describe, expect, it } from 'vitest'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { createMirror } from '../../src/mirror/create-mirror'
import { createLocalTransport } from '../../src/mirror/local-transport'
import { createMirrorSource } from '../../src/mirror/source'
import { reviews, reviewsClient } from './mapped-fixture'

describe('mapped mirror child commands', () => {
  it('selects one child by index, restores its draft, and completes parked waits independently', async () => {
    const run = reviews.create(
      { ids: ['left', 'right'] },
      { scheduler: createTestScheduler({ now: 1_000 }) },
    )
    await run.start()
    const source = createMirrorSource(run, reviewsClient)
    const mirror = createMirror<typeof reviewsClient>({
      transport: createLocalTransport(source, { serialize: true }),
    })
    const left = mirror.child('batch', 0)
    const right = mirror.child('batch', 1)
    expect(left.path).toEqual(['batch', '0'])
    expect(right.path).toEqual(['batch', '1'])
    expect(await left.setInput('form', { note: 'left-note' })).toMatchObject({ ok: true })
    expect(await left.next()).toMatchObject({ ok: true })
    expect(await right.setInput('form', { note: 'right-note' })).toMatchObject({ ok: true })
    expect(mirror.getSnapshot()?.steps.batch.child?.[1]?.steps.form.input).toEqual({
      note: 'right-note',
    })
    const snapshot = run.getSnapshot()
    mirror.dispose()
    source.dispose()
    run.dispose()

    const restored = reviews.resume(snapshot, { scheduler: createTestScheduler({ now: 2_000 }) })
    const restoredSource = createMirrorSource(restored, reviewsClient)
    const remote = createMirror<typeof reviewsClient>({
      transport: createLocalTransport(restoredSource, { serialize: true }),
    })
    expect(restored.child('batch', 1).getState().steps.form.input).toEqual({ note: 'right-note' })
    expect(remote.getSnapshot()?.steps.batch.child?.[1]?.steps.form.input).toEqual({
      note: 'right-note',
    })
    expect(remote.getSnapshot()?.waitingFor).toEqual([
      { kind: 'event', path: ['batch', '0'], step: 'approval', events: ['approved'] },
      { kind: 'view', path: ['batch', '1'], step: 'form' },
    ])
    expect(await remote.child('batch', 0).send('approved', true)).toMatchObject({ ok: true })
    expect(restored.child('batch', 1).getState().current).toBe('form')
    expect(await remote.child('batch', 1).next()).toMatchObject({ ok: true })
    expect(await remote.child('batch', 1).send('approved', false)).toMatchObject({ ok: true })
    await restored.awaitResult()

    expect(remote.getSnapshot()?.output).toEqual([
      { id: 'left', note: 'left-note', accepted: true },
      { id: 'right', note: 'right-note', accepted: false },
    ])
    remote.dispose()
    restoredSource.dispose()
    restored.dispose()
  })
})

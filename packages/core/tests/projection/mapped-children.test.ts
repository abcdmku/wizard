/** Indexed child projections preserve input positions and JSON-safe gaps under concurrency. */
import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import { createMirror } from '../../src/mirror/create-mirror'
import { createLocalTransport } from '../../src/mirror/local-transport'
import { createMirrorSource } from '../../src/mirror/source'
import { defineProjection } from '../../src/projection/define-projection'
import { defineWizard } from '../../src/wizard/define-wizard'
import { review } from '../mirror/mapped-fixture'

const wizard = defineWizard(
  { name: 'ordered-child-projection', context: boundary.trusted<{ ids: string[] }>() },
  ({ flow, step, steps }) =>
    steps({
      batch: flow(review, {
        each: ({ context }) => context.ids,
        key: (id) => id,
        concurrency: 1,
        context: ({ item }) => ({ id: item }),
      }),
      '@each/batch/0/a%2Fb': step({ next: null }),
    }),
)
const projected = defineProjection(wizard, {
  expose: { steps: { batch: { child: { context: ['id'], steps: { form: { input: true } } } } } },
})

describe('mapped child projections', () => {
  it('uses null for queued items, keeps summaries separate, and preserves positions across resume', async () => {
    const run = wizard.create({ ids: ['a/b', 'b', 'c'] })
    await run.start()
    const source = createMirrorSource(run, projected)
    const mirror = createMirror<typeof projected>({
      transport: createLocalTransport(source, { serialize: true }),
    })
    const contexts = () =>
      mirror.getSnapshot()?.steps.batch.child?.map((child) => child?.context ?? null)
    expect(contexts()).toEqual([{ id: 'a/b' }, null, null])
    const summary = defineProjection(wizard, { expose: { steps: { batch: { child: true } } } })
    expect(
      run
        .project(summary)
        .steps.batch.child?.map((child) =>
          child === null ? null : { status: child.status, current: child.current },
        ),
    ).toEqual([{ status: 'waiting', current: 'form' }, null, null])
    expect(run.project(defineProjection(wizard, { expose: {} })).steps.batch).not.toHaveProperty(
      'child',
    )
    expect(await mirror.child('batch', 0).setInput('form', { note: 'first' })).toMatchObject({
      ok: true,
    })
    expect(await mirror.child('batch', 0).next()).toMatchObject({ ok: true })
    expect(await mirror.child('batch', 0).send('approved', true)).toMatchObject({ ok: true })
    expect(contexts()).toEqual([{ id: 'a/b' }, { id: 'b' }, null])
    const snapshot = run.getSnapshot()
    mirror.dispose()
    source.dispose()
    run.dispose()

    const restored = wizard.resume(snapshot)
    const restoredSource = createMirrorSource(restored, projected)
    const remote = createMirror<typeof projected>({
      transport: createLocalTransport(restoredSource, { serialize: true }),
    })
    expect(remote.getSnapshot()?.steps.batch.child?.map((child) => child?.context ?? null)).toEqual(
      [{ id: 'a/b' }, { id: 'b' }, null],
    )
    expect(remote.getSnapshot()?.steps.batch.child?.[0]?.status).toBe('done')
    expect(remote.getSnapshot()?.steps.batch.child?.[1]?.current).toBe('form')
    remote.dispose()
    restoredSource.dispose()
    restored.dispose()
  })
})

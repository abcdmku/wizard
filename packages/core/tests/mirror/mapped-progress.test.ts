/** Mapped child progress still requires explicit child opt-in, including encoded item addresses. */
import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { createMirror } from '../../src/mirror/create-mirror'
import { createLocalTransport } from '../../src/mirror/local-transport'
import { createMirrorSource } from '../../src/mirror/source'
import { defineProjection } from '../../src/projection/define-projection'
import { defineWizard } from '../../src/wizard/define-wizard'

const child = defineWizard(
  { name: 'mapped-reporter', context: boundary.trusted<{ id: string }>() },
  ({ step, steps }) =>
    steps({
      upload: step({
        run: ({ context, progress }) => {
          progress(context.id)
          return context.id
        },
      }),
    }),
)
const wizard = defineWizard(
  { name: 'mapped-progress', context: boundary.trusted<Record<string, never>>() },
  ({ flow, step, steps }) =>
    steps({
      batch: flow(child, {
        each: () => ['a/b', 'b'],
        key: (item) => item,
        concurrency: 2,
        context: ({ item }) => ({ id: item }),
      }),
      '@each/batch/0/a%2Fb': step({ next: null }),
    }),
)

describe('mapped child mirror progress', () => {
  it('separates child hook values from the owning map completion counts', async () => {
    const run = wizard.create({}, { scheduler: createTestScheduler({ now: 1_000 }) })
    const nested = defineProjection(wizard, {
      select: (state) => state.status,
      progress: { batch: { child: { upload: true } } },
    })
    const mapOnly = defineProjection(wizard, {
      select: (state) => state.status,
      progress: { batch: true },
    })
    const watched = createMirror<typeof nested>({
      transport: createLocalTransport(createMirrorSource(run, nested), { serialize: true }),
    })
    const summary = createMirror<typeof mapOnly>({
      transport: createLocalTransport(createMirrorSource(run, mapOnly), { serialize: true }),
    })
    const childEvents: { step: string; value: unknown; path: readonly string[] }[] = []
    const counts: unknown[] = []
    watched.observe(({ step, value, path }) => childEvents.push({ step, value, path }))
    summary.observe((event) => counts.push(event.value))
    await run.start()
    const result = await run.awaitResult()

    expect(result.status).toBe('done')
    expect(childEvents).toEqual([
      { step: 'upload', value: 'a/b', path: ['batch', '0'] },
      { step: 'upload', value: 'b', path: ['batch', '1'] },
    ])
    expect(counts).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ])
    watched.dispose()
    summary.dispose()
    run.dispose()
  })
})

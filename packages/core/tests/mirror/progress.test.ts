/**
 * A hook's transient `progress(value)` crosses the wire as a progress frame and reaches
 * `mirror.observe()` exactly like the local `run.observe()`, but only for steps the projection
 * exposes with `progress: true` (deny-by-default).
 */
import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { createMirror } from '../../src/mirror/create-mirror'
import { createLocalTransport } from '../../src/mirror/local-transport'
import { createMirrorSource } from '../../src/mirror/source'
import { defineProjection, type Projection } from '../../src/projection/define-projection'
import { createRun, type RunEvent } from '../../src/wizard/create-wizard'
import { defineWizard } from '../../src/wizard/define-wizard'

/** A flow whose `work` step reports `progress(value)` once `release()` is called, then completes. */
function reporting(name: string, value: number) {
  let release = (): void => {}
  const flow = defineWizard(
    { name, context: boundary.trusted<Record<string, never>>() },
    ({ step, steps }) =>
      steps(
        {
          work: step({
            run: async ({ progress }) => {
              await new Promise<void>((resolve) => {
                release = resolve
              })
              progress(value)
              return 'done'
            },
            next: 'end',
          }),
          end: step({ run: () => 'ok' }),
        },
        { start: 'work' },
      ),
  )
  return { flow, release: () => release() }
}
const upload = reporting('upload', 50)
const scan = reporting('scan', 75)
const batchFlow = defineWizard(
  { name: 'batch', context: boundary.trusted<Record<string, never>>() },
  ({ step, child, steps }) =>
    steps(
      {
        sub: child(scan.flow, { context: () => ({}), next: 'end' }),
        end: step({ run: () => 'ok' }),
      },
      { start: 'sub' },
    ),
)
const scheduler = () => createTestScheduler({ now: 1000 })
describe('mirror progress', () => {
  it('forwards the progress of steps exposed with `progress: true`; the run-level progress summary forwards none', async () => {
    const run = createRun(upload.flow, { context: {}, instanceId: 'up-1', scheduler: scheduler() })
    const remote = (projection: Projection<typeof upload.flow, unknown>) =>
      createMirror<typeof projection>({
        transport: createLocalTransport(createMirrorSource(run, projection), { serialize: true }),
      })
    const watched = remote(
      defineProjection(upload.flow, { expose: { steps: { work: { progress: true } } } }),
    )
    const summary = remote(defineProjection(upload.flow, { expose: { progress: true } }))
    const seen: RunEvent<typeof upload.flow>[] = []
    const unseen: RunEvent<typeof upload.flow>[] = []
    watched.observe((event) => seen.push(event))
    summary.observe((event) => unseen.push(event))
    await run.start()
    const seq = run.getState().seq
    upload.release()
    await run.awaitResult()
    expect(unseen).toEqual([])
    expect(seen).toEqual([
      { type: 'step.progress', step: 'work', value: 50, seq, at: 1000, path: [] },
    ])
    run.dispose()
  })
  it('a source over a child run forwards that child flow’s own progress', async () => {
    const run = createRun(batchFlow, { context: {}, instanceId: 'b-1', scheduler: scheduler() })
    await run.start()
    const child = run.child('sub')
    const projection = defineProjection(scan.flow, {
      expose: { steps: { work: { progress: true } } },
    })
    const mirror = createMirror<typeof projection>({
      transport: createLocalTransport(createMirrorSource(child, projection), { serialize: true }),
    })
    const seen: RunEvent<typeof scan.flow>[] = []
    mirror.observe((event) => seen.push(event))
    const seq = child.getState().seq
    scan.release()
    await run.awaitResult()
    expect(seen).toEqual([
      { type: 'step.progress', step: 'work', value: 75, seq, at: 1000, path: [] },
    ])
    run.dispose()
  })
  it('a throwing observer does not keep the event from the others; the error goes to onListenerError', async () => {
    const run = createRun(upload.flow, { context: {}, instanceId: 'up-2', scheduler: scheduler() })
    const projection = defineProjection(upload.flow, {
      expose: { steps: { work: { progress: true } } },
    })
    const errors: unknown[] = []
    const mirror = createMirror<typeof projection>({
      transport: createLocalTransport(createMirrorSource(run, projection)),
      onListenerError: (error) => errors.push(error),
    })
    const failure = new Error('observer failed')
    const values: unknown[] = []
    mirror.observe(() => {
      throw failure
    })
    mirror.observe((event) => values.push(event.value))
    await run.start()
    upload.release()
    await run.awaitResult()
    expect(values).toEqual([50])
    expect(errors).toEqual([failure])
    run.dispose()
  })

  it('select forwards only explicitly opted-in step progress and leaves selected state unchanged', async () => {
    const run = upload.flow.create({}, { instanceId: 'select-1', scheduler: scheduler() })
    const selected = defineProjection(upload.flow, {
      select: (state) => ({ status: state.status }),
      progress: { work: true },
    })
    const hidden = defineProjection(upload.flow, { select: (state) => ({ status: state.status }) })
    const watched = createMirror<typeof selected>({
      transport: createLocalTransport(createMirrorSource(run, selected), { serialize: true }),
    })
    const unwatched = createMirror<typeof hidden>({
      transport: createLocalTransport(createMirrorSource(run, hidden), { serialize: true }),
    })
    const values: unknown[] = []
    const hiddenValues: unknown[] = []
    watched.observe((event) => values.push(event.value))
    unwatched.observe((event) => hiddenValues.push(event.value))
    await run.start()
    upload.release()
    await run.awaitResult()

    expect(values).toEqual([50])
    expect(hiddenValues).toEqual([])
    expect(watched.getSnapshot()).toEqual({ status: 'done' })
    expect(run.log().some((event) => event.type === 'step.progress')).toBe(false)
    watched.dispose()
    unwatched.dispose()
    run.dispose()
  })

  it('select requires a nested child opt-in and reports paths relative to the source run', async () => {
    const run = batchFlow.create({}, { instanceId: 'nested-select', scheduler: scheduler() })
    const nested = defineProjection(batchFlow, {
      select: (state) => state.status,
      progress: { sub: { child: { work: true } } },
    })
    const summaryOnly = defineProjection(batchFlow, {
      select: (state) => state.status,
      progress: { sub: true },
    })
    const watched = createMirror<typeof nested>({
      transport: createLocalTransport(createMirrorSource(run, nested), { serialize: true }),
    })
    const unwatched = createMirror<typeof summaryOnly>({
      transport: createLocalTransport(createMirrorSource(run, summaryOnly), { serialize: true }),
    })
    const paths: string[][] = []
    const hiddenValues: unknown[] = []
    watched.observe((event) => paths.push([...event.path]))
    unwatched.observe((event) => hiddenValues.push(event.value))
    await run.start()
    const child = run.child('sub')
    const childProjection = defineProjection(scan.flow, {
      select: (state) => state.status,
      progress: { work: true },
    })
    const childMirror = createMirror<typeof childProjection>({
      transport: createLocalTransport(createMirrorSource(child, childProjection), {
        serialize: true,
      }),
    })
    const childPaths: string[][] = []
    childMirror.observe((event) => childPaths.push([...event.path]))
    scan.release()
    await run.awaitResult()

    expect(paths).toEqual([['sub']])
    expect(childPaths).toEqual([[]])
    expect(hiddenValues).toEqual([])
    watched.dispose()
    unwatched.dispose()
    childMirror.dispose()
    run.dispose()
  })

  it('a failing source subscriber cannot block progress or snapshots for another client', async () => {
    const run = upload.flow.create({}, { instanceId: 'source-listeners', scheduler: scheduler() })
    const projection = defineProjection(upload.flow, {
      select: (state) => state.status,
      progress: { work: { progress: true } },
    })
    const failure = new Error('source subscriber failed')
    const errors: unknown[] = []
    const source = createMirrorSource(run, projection, {
      onListenerError: (error) => errors.push(error),
    })
    source.subscribe(() => {
      throw failure
    })
    const mirror = createMirror<typeof projection>({ transport: createLocalTransport(source) })
    const values: unknown[] = []
    mirror.observe((event) => values.push(event.value))
    await run.start()
    upload.release()
    await run.awaitResult()

    expect(values).toEqual([50])
    expect(mirror.getSnapshot()).toBe('done')
    expect(errors.length).toBeGreaterThan(1)
    expect(errors.every((error) => error === failure)).toBe(true)
    mirror.dispose()
    source.dispose()
    run.dispose()
  })
})

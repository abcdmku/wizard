/** Select progress is a separate per-step opt-in; mapper inference and scope stay intact. */
import { describe, expectTypeOf, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import type { RunStatus } from '../../src/authoring/types'
import { createMirror } from '../../src/mirror/create-mirror'
import { createMirrorSource } from '../../src/mirror/source'
import { defineProjection, type ProjectionOutput } from '../../src/projection/define-projection'
import type { Snapshot } from '../../src/wizard/create-wizard'
import { defineWizard } from '../../src/wizard/define-wizard'

const childWizard = defineWizard(
  { name: 'progress-child', context: boundary.trusted<{ n: number }>() },
  ({ step, steps }) => steps({ work: step({ run: ({ context }) => context.n }) }),
)
const wizard = defineWizard(
  { name: 'progress-types', context: boundary.trusted<{ n: number }>() },
  ({ step, child, steps }) =>
    steps({
      load: step({ run: ({ context }) => context.n, next: 'sub' }),
      sub: child(childWizard, { context: ({ context }) => ({ n: context.n }) }),
    }),
)

describe('select progress types', () => {
  it('keeps the mapper state and result precise while checking every progress step', () => {
    const projection = defineProjection(wizard, {
      select: (state) => {
        expectTypeOf(state).toEqualTypeOf<Snapshot<typeof wizard>['state']>()
        return { n: state.context.n, status: state.status }
      },
      progress: { load: true, sub: { progress: false, child: { work: true } } },
    })
    expectTypeOf<ProjectionOutput<typeof projection>>().toEqualTypeOf<{
      n: number
      status: RunStatus
    }>()
    const run = wizard.create({ n: 1 })
    const source = createMirrorSource(run, projection)
    expectTypeOf<ReturnType<typeof source.getFrame>['state']>().toEqualTypeOf<{
      n: number
      status: RunStatus
    }>()
    const mirror = createMirror<typeof projection>({ initial: source.getFrame() })
    mirror.observe((event) => {
      expectTypeOf(event.value).toEqualTypeOf<unknown>()
      expectTypeOf(event.type).toEqualTypeOf<'step.progress'>()
    })
    // @ts-expect-error unknown root step
    defineProjection(wizard, { select: (state) => state.status, progress: { missing: true } })
    defineProjection(wizard, {
      select: (state) => {
        expectTypeOf(state.context.n).toEqualTypeOf<number>()
        return state.status
      },
      // @ts-expect-error unknown child step
      progress: { sub: { child: { missing: true } } },
    })
    defineProjection(wizard, {
      select: (state) => state.status,
      // @ts-expect-error a runnable step does not contain a child wizard
      progress: { load: { child: { work: true } } },
    })
    // @ts-expect-error root progress is a per-step map
    defineProjection(wizard, { select: (state) => state.status, progress: true })
    // @ts-expect-error expose controls its step progress directly
    defineProjection(wizard, { expose: {}, progress: { load: true } })
  })

  it('keeps a scoped mapper inferred and still requires its scope', () => {
    const projection = defineProjection(wizard, {
      scope: boundary.trusted<{ viewerId: string }>(),
      select: ({ state, scope }) => ({ n: state.context.n, viewerId: scope.viewerId }),
      progress: { sub: { child: { work: true } } },
    })
    expectTypeOf<ProjectionOutput<typeof projection>>().toEqualTypeOf<{
      n: number
      viewerId: string
    }>()
    const run = wizard.create({ n: 2 })
    expectTypeOf(run.project(projection, { viewerId: 'reader' })).toEqualTypeOf<{
      n: number
      viewerId: string
    }>()
    // @ts-expect-error progress opt-in does not remove the required principal
    createMirrorSource(run, projection)
  })
})

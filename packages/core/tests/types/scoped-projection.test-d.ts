/** Type contract for principal-scoped projections and Mirror source authorization. */
import { describe, expectTypeOf, it } from 'vitest'
import {
  boundary,
  type Command,
  defineProjection,
  defineWizard,
  type ProjectionOutput,
  type ProjectionScope,
  type Run,
  type Snapshot,
} from '../../src/index'
import { createMirrorSource, type MirrorSourceOptions } from '../../src/mirror'

interface Viewer {
  readonly tenantId: string
  readonly permissions: readonly string[]
}
const flow = defineWizard(
  {
    name: 'scoped-types',
    context: boundary.trusted<{
      readonly tenantId: string
      readonly secret: string
    }>(),
  },
  ({ step, view, steps }) =>
    steps(
      {
        form: view({ next: 'done' }),
        done: step({ next: null }),
      },
      { start: 'form' },
    ),
)
const scoped = defineProjection(flow, {
  scope: boundary.trusted<Viewer>(),
  select: ({ state, scope }) => {
    expectTypeOf(state).toEqualTypeOf<Snapshot<typeof flow>['state']>()
    expectTypeOf(scope).toEqualTypeOf<Viewer>()
    return { allowed: state.context.tenantId === scope.tenantId }
  },
})
const unscoped = defineProjection(flow, {
  select: (state) => ({ seq: state.seq }),
})
declare const run: Run<typeof flow>
declare const viewer: Viewer
describe('scoped projection types', () => {
  it('extracts scope and conditionally requires it for project', () => {
    expectTypeOf<ProjectionScope<typeof scoped>>().toEqualTypeOf<Viewer>()
    expectTypeOf<MirrorSourceOptions<typeof flow, Viewer>['scope']>().toEqualTypeOf<Viewer>()
    expectTypeOf<ProjectionScope<typeof unscoped>>().toEqualTypeOf<never>()
    expectTypeOf(run.project(scoped, viewer)).toEqualTypeOf<{
      allowed: boolean
    }>()
    expectTypeOf(run.project(unscoped)).toEqualTypeOf<{
      seq: number
    }>()
    // @ts-expect-error a scoped projection requires its scope
    run.project(scoped)
    // @ts-expect-error the scope must match the projection boundary
    run.project(scoped, { tenantId: 't' })
    // @ts-expect-error an unscoped projection takes no scope argument
    run.project(unscoped, viewer)
  })
  it('requires scoped source options and types authorize inputs', () => {
    const source = createMirrorSource(run, scoped, {
      scope: viewer,
      authorize: ({ state, command, scope }) => {
        expectTypeOf(state).toEqualTypeOf<Snapshot<typeof flow>['state']>()
        expectTypeOf(command).toEqualTypeOf<Command<typeof flow>>()
        expectTypeOf(scope).toEqualTypeOf<Viewer>()
        return scope.permissions.includes(command.type)
      },
    })
    expectTypeOf(source.subscribe).toBeFunction()
    // @ts-expect-error scoped sources require an options object with scope
    createMirrorSource(run, scoped)
    // @ts-expect-error scoped source options require scope
    createMirrorSource(run, scoped, { authorize: () => true })
    // @ts-expect-error wrong scope type
    createMirrorSource(run, scoped, { scope: { tenantId: 't' } })
    const plain = createMirrorSource(run, unscoped)
    expectTypeOf<ReturnType<typeof plain.getFrame>['state']>().toEqualTypeOf<
      ProjectionOutput<typeof unscoped>
    >()
  })
})

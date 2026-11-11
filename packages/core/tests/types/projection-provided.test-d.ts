/** Provisioning leaves projection state and wire inference intact without casts. */
import { describe, expectTypeOf, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import type { AnyWizardDefinition } from '../../src/authoring/types'
import { createMirror } from '../../src/mirror/create-mirror'
import { createMirrorSource, type MirrorSource } from '../../src/mirror/source'
import {
  defineProjection,
  type Projection,
  type ProjectionOutput,
} from '../../src/projection/define-projection'
import type { Run } from '../../src/wizard/create-wizard'
import { defineWizard } from '../../src/wizard/define-wizard'

const wizard = defineWizard(
  {
    name: 'provided-projection-types',
    context: boundary.trusted<{ n: number }>(),
    deps: boundary.trusted<{ prefix: string; multiplier: number }>(),
  },
  ({ step, steps }) =>
    steps({
      work: step({ run: ({ context, deps }) => `${deps.prefix}${context.n * deps.multiplier}` }),
    }),
)
const exposed = defineProjection(wizard, {
  expose: { output: true, steps: { work: { output: true } } },
})
const selected = defineProjection(wizard, {
  select: (state) => ({ n: state.context.n, result: state.steps.work.output }),
})

describe('provided projection types', () => {
  it('retains a generic adapter over an ordinary run and its projection', () => {
    const adapt = <F extends AnyWizardDefinition, S>(
      run: Run<F>,
      projection: Projection<F, S>,
    ) => ({
      state: run.project(projection),
      source: createMirrorSource(run, projection),
    })
    const run = wizard.create({ n: 3 }, { deps: { prefix: 'generic:', multiplier: 2 } })
    const adapter = adapt(run, exposed)
    expectTypeOf(adapter.state).toEqualTypeOf<ProjectionOutput<typeof exposed>>()
    expectTypeOf(adapter.source).toEqualTypeOf<MirrorSource<ProjectionOutput<typeof exposed>>>()
  })
  it('accepts module projections and keeps state/output types on provided runs and sources', () => {
    const provided = wizard.provide({ prefix: 'result:' }).provide({ multiplier: 2 })
    const run = provided.create({ n: 3 })
    expectTypeOf(run.project(exposed)).toEqualTypeOf<ProjectionOutput<typeof exposed>>()
    expectTypeOf(run.project(selected)).toEqualTypeOf<{ n: number; result: string | undefined }>()
    const source = createMirrorSource(run, exposed)
    expectTypeOf(source).toEqualTypeOf<MirrorSource<ProjectionOutput<typeof exposed>>>()
    const mirror = createMirror<typeof exposed>({ initial: source.getFrame() })
    expectTypeOf(mirror.getSnapshot()?.output).toEqualTypeOf<string | undefined>()
    // @ts-expect-error providing one dependency leaves the other required at creation
    wizard.provide({ prefix: 'partial:' }).create({ n: 3 })
  })
})

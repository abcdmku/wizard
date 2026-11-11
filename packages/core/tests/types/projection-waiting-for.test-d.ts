/** Projected root wait ids stay typed while nested waits remain path-addressed. */
import { describe, expectTypeOf, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import { defineProjection, type ProjectionOutput } from '../../src/projection/define-projection'
import { defineWizard } from '../../src/wizard/define-wizard'
import type { WaitingFor } from '../../src/wizard/results'

const wizard = defineWizard(
  {
    name: 'wait-types',
    context: boundary.trusted<Record<string, never>>(),
    events: { approved: boundary.trusted<boolean>() },
  },
  ({ view, step, steps }) =>
    steps({
      form: view({ input: boundary.trusted<{ note: string }>(), next: 'wait' }),
      wait: step({ waitFor: { approved: ({ payload }) => ({ done: payload }) } }),
    }),
)

describe('projected wait types', () => {
  it('adds only the explicitly exposed typed waitingFor field', () => {
    const visible = defineProjection(wizard, { expose: { waitingFor: true } })
    const hidden = defineProjection(wizard, { expose: {} })
    expectTypeOf<ProjectionOutput<typeof visible>['waitingFor']>().toEqualTypeOf<
      readonly WaitingFor<typeof wizard>[]
    >()
    type RootWait = Extract<WaitingFor<typeof wizard>, { readonly path: readonly [] }>
    expectTypeOf<RootWait['step']>().toEqualTypeOf<'form' | 'wait'>()
    expectTypeOf<Extract<RootWait, { readonly kind: 'event' }>['events']>().toEqualTypeOf<
      readonly 'approved'[]
    >()
    const run = wizard.create({})
    // @ts-expect-error waits are absent until explicitly exposed
    run.project(hidden).waitingFor
  })
})

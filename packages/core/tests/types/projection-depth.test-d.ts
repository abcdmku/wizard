/** Nested projections preserve eight child levels before the depth fallback. */
import { describe, expectTypeOf, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import {
  type ClientState,
  type ClientStateFallback,
  defineProjection,
  type ProjectionOutput,
} from '../../src/projection/define-projection'
import { defineWizard } from '../../src/wizard/define-wizard'

const leafCtx = boundary.trusted<{ n: number }>()
export const deep0 = defineWizard({ name: 'deep0', context: leafCtx }, ({ step, view, steps }) =>
  steps({ v: view({ next: 'end' }), end: step({ run: ({ context }) => context.n }) }),
)
export const deep1 = defineWizard({ name: 'deep1', context: leafCtx }, ({ child, steps }) =>
  steps({ child: child(deep0, { context: ({ context }) => ({ n: context.n }) }) }),
)
export const deep2 = defineWizard({ name: 'deep2', context: leafCtx }, ({ child, steps }) =>
  steps({ child: child(deep1, { context: ({ context }) => ({ n: context.n }) }) }),
)
export const deep3 = defineWizard({ name: 'deep3', context: leafCtx }, ({ child, steps }) =>
  steps({ child: child(deep2, { context: ({ context }) => ({ n: context.n }) }) }),
)
export const deep4 = defineWizard({ name: 'deep4', context: leafCtx }, ({ child, steps }) =>
  steps({ child: child(deep3, { context: ({ context }) => ({ n: context.n }) }) }),
)
export const deep5 = defineWizard({ name: 'deep5', context: leafCtx }, ({ child, steps }) =>
  steps({ child: child(deep4, { context: ({ context }) => ({ n: context.n }) }) }),
)
export const deep6 = defineWizard({ name: 'deep6', context: leafCtx }, ({ child, steps }) =>
  steps({ child: child(deep5, { context: ({ context }) => ({ n: context.n }) }) }),
)
export const deep7 = defineWizard({ name: 'deep7', context: leafCtx }, ({ child, steps }) =>
  steps({ child: child(deep6, { context: ({ context }) => ({ n: context.n }) }) }),
)
export const deep8 = defineWizard({ name: 'deep8', context: leafCtx }, ({ child, steps }) =>
  steps({ child: child(deep7, { context: ({ context }) => ({ n: context.n }) }) }),
)
export const deepReal = defineWizard({ name: 'deepReal', context: leafCtx }, ({ child, steps }) =>
  steps({ child: child(deep8, { context: ({ context }) => ({ n: context.n }) }) }),
)

type ExposeChild<Inner> = {
  readonly steps: {
    readonly child: {
      readonly output: true
      readonly child: Inner
    }
  }
}
type E0 = {
  readonly steps: {
    readonly v: {
      readonly input: true
    }
  }
}
type E1 = ExposeChild<E0>
type E2 = ExposeChild<E1>
type E3 = ExposeChild<E2>
type E4 = ExposeChild<E3>
type E5 = ExposeChild<E4>
type E6 = ExposeChild<E5>
type E7 = ExposeChild<E6>
type E8 = ExposeChild<E7>
type CS8 = ClientState<typeof deep8, E8>
type L1 = NonNullable<CS8['steps']['child']['child']>
type L2 = NonNullable<L1['steps']['child']['child']>
type L3 = NonNullable<L2['steps']['child']['child']>
type L4 = NonNullable<L3['steps']['child']['child']>
type L5 = NonNullable<L4['steps']['child']['child']>
type L6 = NonNullable<L5['steps']['child']['child']>
type L7 = NonNullable<L6['steps']['child']['child']>
type L8 = NonNullable<L7['steps']['child']['child']>
type CS9 = ClientState<typeof deepReal, ExposeChild<E8>>
type M1 = NonNullable<CS9['steps']['child']['child']>
type M2 = NonNullable<M1['steps']['child']['child']>
type M3 = NonNullable<M2['steps']['child']['child']>
type M4 = NonNullable<M3['steps']['child']['child']>
type M5 = NonNullable<M4['steps']['child']['child']>
type M6 = NonNullable<M5['steps']['child']['child']>
type M7 = NonNullable<M6['steps']['child']['child']>
type M8 = NonNullable<M7['steps']['child']['child']>
type M9 = NonNullable<M8['steps']['child']['child']>
describe('nesting depth budget (8 child edges below the root)', () => {
  it('child levels 1–8 are precise, level 9 is the fallback (the root does not consume the budget)', () => {
    // deep8 as the root: its 8 nested children (deep7 … deep0) are all precise.
    expectTypeOf<CS8['steps']['child']['output']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<L7['steps']['child']['output']>().toEqualTypeOf<number | undefined>() // deep1 (7 child levels below the root)
    expectTypeOf<L8['steps']['v']['input']>().toEqualTypeOf<never | undefined>() // deep0 (8 child levels below the root) is still precise
    expectTypeOf<L8['context']>().toEqualTypeOf<{}>()
    // deepReal as the root (deep8 = level 1 … deep0 = level 9): the 9th child level is the fallback.
    expectTypeOf<M8['steps']['child']['output']>().toEqualTypeOf<number | undefined>() // deep1 (level 8)
    expectTypeOf<M9>().toEqualTypeOf<ClientStateFallback>() // deep0 (level 9)
  })
  it('a real 2-level defineProjection is typed', () => {
    const deepProjection = defineProjection(deepReal, {
      expose: { steps: { child: { output: true, child: { steps: { child: { output: true } } } } } },
    })
    expectTypeOf<
      NonNullable<
        ProjectionOutput<typeof deepProjection>['steps']['child']['child']
      >['steps']['child']['output']
    >().toEqualTypeOf<number | undefined>()
  })
})

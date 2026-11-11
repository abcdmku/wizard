import { describe, expectTypeOf, it } from 'vitest'
import { boundary, defineWizard } from '../../src'

interface Context {
  readonly accountId: string
}

interface Deps {
  readonly defaultName: string
}

export const valid = defineWizard(
  {
    name: 'dynamic-initial-types',
    context: boundary.trusted<Context>(),
    deps: boundary.trusted<Deps>(),
  },
  ({ view, step, steps }) => {
    view({
      input: boundary.trusted<{ quantity: number }>(),
      // @ts-expect-error initializer values use the input side of the boundary
      initial: () => ({ quantity: 'wrong' }),
    })
    view({
      // @ts-expect-error an initializer requires an input boundary
      initial: async ({ context }) => ({ accountId: context.accountId }),
    })
    view({
      input: boundary.trusted<{ name: string }>(),
      initial: (args) => {
        // @ts-expect-error initializers expose only context and deps
        args.update({ accountId: 'other' })
        return { name: args.deps.defaultName }
      },
    })

    return steps({
      sync: view({
        input: boundary.trusted<{ name: string; quantity: number }>(),
        initial: ({ context, deps }) => {
          expectTypeOf(context).toEqualTypeOf<Context>()
          expectTypeOf(deps).toEqualTypeOf<Deps>()
          return { name: `${deps.defaultName}:${context.accountId}` }
        },
        next: 'async',
      }),
      async: view({
        input: boundary.trusted<{ name: string; quantity: number }>(),
        initial: async ({ context, deps }) => ({
          name: deps.defaultName,
          quantity: context.accountId.length,
        }),
        next: 'static',
      }),
      static: view({
        input: boundary.trusted<{ name: string; quantity: number }>(),
        initial: { name: 'existing value' },
        next: 'done',
      }),
      done: step({}),
    })
  },
)

describe('dynamic view initial types', () => {
  it('accepts partial drafts synchronously or asynchronously', () => {
    expectTypeOf(valid.steps.sync.kind).toEqualTypeOf<'view'>()
  })
})

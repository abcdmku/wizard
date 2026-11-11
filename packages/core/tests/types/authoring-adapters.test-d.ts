import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { RUN_ADAPTER, type RunAdapter } from '../../src/authoring/run-adapter'
import type {
  EachRunArgs,
  ErrorOf,
  JsonValue,
  MaybePromise,
  OutputOf,
  RunArgs,
} from '../../src/authoring/types'
import { defineWizard } from '../../src/wizard/define-wizard'

declare function adapter<C, D, O, E extends JsonValue = never>(
  program: (args: RunArgs<C, D>) => MaybePromise<O>,
  options?: { mapError: (error: unknown) => E },
): RunAdapter<C, D, O, E>

type Services = { read: (id: string) => Promise<number> }
const deferred = defineWizard(
  {
    name: 'deferred-adapters',
    context: z.object({ ids: z.array(z.string()) }),
    deps: boundary.trusted<Services>(),
  },
  ({ step, steps }) => {
    const load = step({ run: () => ({ offset: 1 }) })
    return steps({
      load,
      mapped: step({
        needs: { load },
        each: ({ context }) => context.ids,
        run: ({ item, index, needs }) => {
          expectTypeOf(item).toEqualTypeOf<string>()
          expectTypeOf(index).toEqualTypeOf<number>()
          expectTypeOf(needs.load).toEqualTypeOf<{ offset: number }>()
          return adapter(({ deps }) => deps.read(item).then((value) => value + needs.load.offset), {
            mapError: () => ({ code: 'DOWN' as const }),
          })
        },
        retry: { retries: 1, when: (error) => error.code === 'DOWN' },
      }),
      awaited: step({
        run: async () =>
          adapter(({ deps }) => deps.read('one'), { mapError: () => ({ async: true as const }) }),
        retry: { retries: 1, when: (error) => error.async },
      }),
      mixed: step({
        run: ({ context }) =>
          context.ids.length
            ? adapter(({ deps }) => deps.read(context.ids[0] ?? ''), {
                mapError: () => ({ mixed: true as const }),
              })
            : ('empty' as const),
        retry: { retries: 1, when: (error) => error.mixed },
      }),
      override: step({
        run: () => adapter(() => 1, { mapError: () => ({ adapter: true }) }),
        output: boundary.parse((value) => String(value)),
        mapError: () => ({ code: 'OVERRIDE' as const }),
        retry: { retries: 1, when: (error) => error.code === 'OVERRIDE' },
      }),
    })
  },
)
expectTypeOf<OutputOf<typeof deferred, 'mapped'>>().toEqualTypeOf<number[]>()
expectTypeOf<ErrorOf<typeof deferred, 'mapped'>>().toEqualTypeOf<{ code: 'DOWN' }>()
expectTypeOf<OutputOf<typeof deferred, 'awaited'>>().toEqualTypeOf<number>()
expectTypeOf<ErrorOf<typeof deferred, 'awaited'>>().toEqualTypeOf<{ async: true }>()
expectTypeOf<OutputOf<typeof deferred, 'mixed'>>().toEqualTypeOf<number | 'empty'>()
expectTypeOf<ErrorOf<typeof deferred, 'mixed'>>().toEqualTypeOf<{ mixed: true }>()
expectTypeOf<OutputOf<typeof deferred, 'override'>>().toEqualTypeOf<string>()
expectTypeOf<ErrorOf<typeof deferred, 'override'>>().toEqualTypeOf<{ code: 'OVERRIDE' }>()

const classify = (_error: unknown, { attempt }: { attempt: number }) => ({
  code: 'DOWN' as const,
  attempt,
})
const modularErrorMapper = defineWizard(
  { name: 'modular-error-mapper', context: z.object({}) },
  ({ step, steps }) =>
    steps({
      work: step({
        run: () => 1,
        retry: { retries: 1, when: (error) => error.code === 'DOWN' },
        mapError: classify,
      }),
    }),
)
expectTypeOf<ErrorOf<typeof modularErrorMapper, 'work'>>().toEqualTypeOf<{
  code: 'DOWN'
  attempt: number
}>()

declare const foreignContext: RunAdapter<{ missing: string }, Services, number>
declare const foreignDeps: RunAdapter<{ ids: string[] }, { write: () => void }, number>
declare const needsAnItem: RunAdapter<
  { ids: string[] },
  Services,
  number,
  never,
  EachRunArgs<{ ids: string[] }, Services, {}, string>
>
defineWizard(
  {
    name: 'returned-adapter-bindings',
    context: z.object({ ids: z.array(z.string()) }),
    deps: boundary.trusted<Services>(),
  },
  ({ step, steps }) =>
    steps({
      // @ts-expect-error returned adapter context must accept this step's context
      context: step({ run: () => foreignContext }),
      // @ts-expect-error returned adapter services must be provided by this wizard
      deps: step({ run: async () => foreignDeps }),
      // @ts-expect-error an ordinary step cannot supply item arguments
      item: step({ run: () => needsAnItem }),
      // @ts-expect-error branded returned values must use JSON error channels
      malformed: step({
        run: () => ({
          [RUN_ADAPTER]: {
            run: () => 1,
            output: boundary.trusted<number>(),
            '~error': new Date(),
          },
        }),
      }),
    }),
)

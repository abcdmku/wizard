import {
  boundary,
  defineFlow,
  type ErrorOf,
  type OutputOf,
  type TaskAdapter,
} from '@openwizard/core'
import { Context, Effect, Layer, ManagedRuntime } from 'effect'
import { expectTypeOf } from 'vitest'
import { type EffectV4Runner, makeEffectV4Runner } from '../src'
import { failureSchema, outputSchema, schema } from './fixtures'

const needsOutputSchema = schema<{ readonly ok: true; readonly at: number }>((value) =>
  typeof value === 'object' &&
  value !== null &&
  'ok' in value &&
  value.ok === true &&
  'at' in value &&
  typeof value.at === 'number'
    ? { ok: true, at: value.at }
    : undefined,
)
const needsErrorSchema = schema<{ readonly code: string }>((value) =>
  typeof value === 'object' && value !== null && 'code' in value && typeof value.code === 'string'
    ? { code: value.code }
    : undefined,
)

class Clock extends Context.Service<Clock, { readonly now: () => number }>()('Clock') {}

const clockLayer = Layer.succeed(Clock, { now: () => 1 })
const layerRunner = makeEffectV4Runner(clockLayer)
expectTypeOf(layerRunner).toMatchTypeOf<EffectV4Runner<Clock>>()

const runtime = ManagedRuntime.make(clockLayer)
const runner = makeEffectV4Runner(runtime)
expectTypeOf(runner).toMatchTypeOf<EffectV4Runner<Clock>>()

const needsClock = () =>
  Clock.use((clock) =>
    Effect.succeed({ ok: true as const, at: clock.now() }).pipe(
      Effect.mapError(() => ({ code: 'never' as string })),
    ),
  )
type NeedsClockProgram = ReturnType<typeof needsClock>
type NeedsClockParts =
  NeedsClockProgram extends Effect.Effect<infer A, infer E, infer R> ? [A, E, R] : never
expectTypeOf<NeedsClockParts>().toEqualTypeOf<[{ ok: true; at: number }, { code: string }, Clock]>()

const adapter = runner.task(needsClock, {
  output: needsOutputSchema,
  error: needsErrorSchema,
})
expectTypeOf(adapter).toMatchTypeOf<
  TaskAdapter<unknown, unknown, { ok: true; at: number }, { code: string }>
>()

const flow = defineFlow({ name: 'types-v4', context: boundary.trusted<{}>() })
const flowWithTask = flow.steps({ task: flow.task(adapter) }, { start: 'task' })
expectTypeOf<OutputOf<typeof flowWithTask, 'task'>>().toEqualTypeOf<{ ok: true; at: number }>()
expectTypeOf<ErrorOf<typeof flowWithTask, 'task'>>().toEqualTypeOf<{ code: string }>()

const emptyRunner = makeEffectV4Runner(Layer.empty)
// @ts-expect-error missing Clock must make the task options impossible
emptyRunner.task(needsClock, { output: outputSchema, error: failureSchema })
// @ts-expect-error output is required
runner.task(() => Effect.succeed(1), { error: schema<never>(() => undefined) })
// @ts-expect-error error is required
runner.task(() => Effect.succeed(1), {
  output: schema<number>((value) => (typeof value === 'number' ? value : undefined)),
})

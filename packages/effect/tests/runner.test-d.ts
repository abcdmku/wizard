import {
  boundary,
  defineFlow,
  type ErrorOf,
  type OutputOf,
  type TaskAdapter,
} from '@openwizard/core'
import { Context, Effect, Layer, ManagedRuntime } from 'effect'
import type * as ManagedRuntimeModule from 'effect/ManagedRuntime'
import { expectTypeOf } from 'vitest'
import { type EffectRunner, makeEffectRunner } from '../src'
import { failureSchema, outputSchema, schema } from './fixtures'

const neverSchema = schema<never>(() => undefined)

class Clock extends Context.Tag('Clock')<Clock, { readonly now: () => number }>() {}

const runtime = ManagedRuntime.make(Layer.succeed(Clock, { now: () => 1 }))
const runner = makeEffectRunner(runtime)
expectTypeOf(runner).toEqualTypeOf<EffectRunner<Clock>>()
expectTypeOf<ManagedRuntimeModule.ManagedRuntime.Context<typeof runtime>>().toEqualTypeOf<Clock>()

const needsClock = () =>
  Effect.flatMap(Clock, (clock) =>
    Effect.succeed({ ok: clock.now() > 0 }).pipe(Effect.mapError(() => ({ code: 'never' }))),
  )

type NeedsClockProgram = ReturnType<typeof needsClock>
type NeedsClockParts =
  NeedsClockProgram extends Effect.Effect<infer A, infer E, infer R> ? [A, E, R] : never
expectTypeOf<NeedsClockParts>().toEqualTypeOf<[{ ok: boolean }, { code: string }, Clock]>()

const task = runner.task(needsClock, { output: outputSchema, error: failureSchema })
expectTypeOf<typeof task>().toMatchTypeOf<
  TaskAdapter<unknown, unknown, { ok: boolean }, { code: string }>
>()

const flowSpec = defineFlow({ name: 'typed-effect', context: boundary.trusted<{}>() })
const flow = flowSpec.steps({ work: flowSpec.task(task) }, { start: 'work' })
expectTypeOf<OutputOf<typeof flow, 'work'>>().toEqualTypeOf<{ ok: boolean }>()
expectTypeOf<ErrorOf<typeof flow, 'work'>>().toEqualTypeOf<{ code: string }>()

const emptyRunner = makeEffectRunner(ManagedRuntime.make(Layer.empty))
// @ts-expect-error a supplied runtime must cover every Effect service
emptyRunner.task(needsClock, { output: outputSchema, error: failureSchema })

// @ts-expect-error output and error schemas are required
runner.task(() => Effect.succeed(1), {})

const successAdapter = runner.task(() => Effect.succeed(1), {
  output: schema<number>((value) => (typeof value === 'number' ? value : undefined)),
  error: neverSchema,
})
// @ts-expect-error an adapter owns its output boundary
flowSpec.task(successAdapter, { output: boundary.trusted<number>() })
// @ts-expect-error an adapter owns typed failures
flowSpec.task(successAdapter, { mapError: () => ({ code: 'x' }) })

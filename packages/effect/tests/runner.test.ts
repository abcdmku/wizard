import { boundary, createRun, defineFlow } from '@openwizard/core'
import { Cause, Effect, Exit, Layer, ManagedRuntime } from 'effect'
import { describe, expect, it } from 'vitest'
import { execute, makeEffectRunner } from '../src'
import { asyncSchema, failureSchema, outputSchema, schema } from './fixtures'

const neverSchema = schema<never>(() => undefined)

const runEffect = <A, E>(program: Effect.Effect<A, E>): Promise<A> =>
  new Promise((resolve, reject) => {
    Effect.runFork(program).addObserver((exit) => {
      if (Exit.isSuccess(exit)) resolve(exit.value)
      else reject(Cause.squash(exit.cause))
    })
  })

const settle = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('condition did not settle')
}

type ErrorWithKind = {
  readonly kind?: string
  readonly data?: unknown
}

function runtime() {
  return ManagedRuntime.make(Layer.empty)
}

describe('@openwizard/effect', () => {
  it('runs one fiber per durable attempt and preserves the output', async () => {
    let calls = 0
    const runner = makeEffectRunner(runtime())
    const retry = defineFlow({ name: 'retry', context: boundary.trusted<{}>() })
    const work = runner.task(
      () => {
        calls += 1
        return calls === 1
          ? Effect.fail({ code: 'temporary' })
          : Effect.succeed({ ok: true as const })
      },
      { output: outputSchema, error: failureSchema },
    )
    const flow = retry.steps(
      {
        work: retry.task(work, { retry: { attempts: 1 }, next: 'done' }),
        done: retry.final({ output: () => ({ ok: true as const }) }),
      },
      { start: 'work' },
    )
    const run = createRun(flow, { context: {} })
    await run.start()
    const result = await run.awaitResult()

    expect(result.status).toBe('done')
    if (result.status === 'done') expect(result.output).toEqual({ ok: true })
    expect(calls).toBe(2)
    await runner.dispose()
  })

  it('stores a schema-validated Effect failure as typed durable data', async () => {
    const runner = makeEffectRunner(runtime())
    const typedFailure = defineFlow({ name: 'typed-failure', context: boundary.trusted<{}>() })
    const work = runner.task(
      (): Effect.Effect<{ readonly ok: true }, { readonly code: string }> =>
        Effect.fail({ code: 'DECLINED' }),
      { output: outputSchema, error: failureSchema },
    )
    const flow = typedFailure.steps({ work: typedFailure.task(work) }, { start: 'work' })
    const run = createRun(flow, { context: {} })
    await run.start()
    await waitFor(() => run.getState().status === 'failed')
    const state = run.getState()

    expect(state.status).toBe('failed')
    const typedError = state.failure?.error as ErrorWithKind
    expect(typedError.kind).toBe('typed')
    expect(typedError.data).toEqual({ code: 'DECLINED' })
    await runner.dispose()
  })

  it('keeps defects and interruptions out of the typed data channel', async () => {
    const runner = makeEffectRunner(runtime())
    const failureKinds = defineFlow({ name: 'failure-kinds', context: boundary.trusted<{}>() })
    const defect = runner.task(
      (): Effect.Effect<{ readonly ok: true }> => Effect.die(new Error('bug')),
      { output: outputSchema, error: neverSchema },
    )
    const defectFlow = failureKinds.steps({ work: failureKinds.task(defect) }, { start: 'work' })
    const defectRun = createRun(defectFlow, { context: {} })
    await defectRun.start()
    await waitFor(() => defectRun.getState().status === 'failed')
    const defectError = defectRun.getState().failure?.error as ErrorWithKind
    expect(defectError.kind).toBe('defect')
    expect(defectError.data).toBeUndefined()

    const interrupted = runner.task((): Effect.Effect<{ readonly ok: true }> => Effect.interrupt, {
      output: outputSchema,
      error: neverSchema,
    })
    const interruptedFlow = failureKinds.steps(
      { work: failureKinds.task(interrupted) },
      { start: 'work' },
    )
    const interruptedRun = createRun(interruptedFlow, { context: {} })
    await interruptedRun.start()
    await waitFor(() => interruptedRun.getState().status === 'failed')
    const interruptedError = interruptedRun.getState().failure?.error as ErrorWithKind
    expect(interruptedError.kind).toBe('interrupted')
    expect(interruptedError.data).toBeUndefined()
    await runner.dispose()
  })

  it('maps FlowRun cancellation to fiber interruption', async () => {
    const runner = makeEffectRunner(runtime())
    const cancel = defineFlow({ name: 'cancel', context: boundary.trusted<{}>() })
    const work = runner.task(
      () => Effect.sleep('10 seconds').pipe(Effect.as({ ok: true as const })),
      { output: outputSchema, error: neverSchema },
    )
    const flow = cancel.steps({ work: cancel.task(work) }, { start: 'work' })
    const run = createRun(flow, { context: {} })
    await run.start()
    await settle()
    await run.cancel('operator')
    const result = await run.awaitResult()
    expect(result.status).toBe('cancelled')
    await runner.dispose()
  })

  it('awaits an existing run as an Effect without a second run API', async () => {
    const runner = makeEffectRunner(runtime())
    const executeFlow = defineFlow({ name: 'execute', context: boundary.trusted<{}>() })
    const work = runner.task(() => Effect.succeed({ ok: true as const }), {
      output: outputSchema,
      error: neverSchema,
    })
    const flow = executeFlow.steps(
      {
        work: executeFlow.task(work, { next: 'done' }),
        done: executeFlow.final({ output: () => ({ done: true as const }) }),
      },
      { start: 'work' },
    )
    const run = createRun(flow, { context: {} })
    const result = await runEffect(execute(run))
    expect(result).toEqual({ done: true })
    await runner.dispose()
  })

  it('accepts asynchronous Standard Schema validation', async () => {
    const runner = makeEffectRunner(runtime())
    const asyncOutput = asyncSchema<{ readonly ok: true }>(async (value) =>
      value !== null && typeof value === 'object' && 'ok' in value && value.ok === true
        ? { ok: true }
        : undefined,
    )
    const asyncSchemaFlow = defineFlow({ name: 'async-schema', context: boundary.trusted<{}>() })
    const work = runner.task(() => Effect.succeed({ ok: true as const }), {
      output: asyncOutput,
      error: neverSchema,
    })
    const flow = asyncSchemaFlow.steps(
      { work: asyncSchemaFlow.task(work, { next: 'done' }), done: asyncSchemaFlow.final() },
      { start: 'work' },
    )
    const run = createRun(flow, { context: {} })
    await run.start()
    expect((await run.awaitResult()).status).toBe('done')
    await runner.dispose()
  })
})

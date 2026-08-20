import { boundary, createRun, defineFlow } from '@openwizard/core'
import { Cause, Effect, Exit, Layer, ManagedRuntime } from 'effect'
import { describe, expect, it } from 'vitest'
import { awaitResult, execute, makeEffectV4Runner } from '../src'
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

describe('@openwizard/effect-v4', () => {
  it('runs one fiber per durable attempt and preserves the output', async () => {
    let calls = 0
    const runner = makeEffectV4Runner(runtime())
    const retryV4 = defineFlow({ name: 'retry-v4', context: boundary.trusted<{}>() })
    const work = runner.task(
      () => {
        calls += 1
        return calls === 1
          ? Effect.fail({ code: 'temporary' })
          : Effect.succeed({ ok: true as const })
      },
      { output: outputSchema, error: failureSchema },
    )
    const flow = retryV4.steps(
      {
        work: retryV4.task(work, { retry: { attempts: 1 }, next: 'done' }),
        done: retryV4.final({ output: () => ({ ok: true as const }) }),
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
    const runner = makeEffectV4Runner(runtime())
    const typedFailureV4 = defineFlow({ name: 'typed-failure-v4', context: boundary.trusted<{}>() })
    const work = runner.task(
      (): Effect.Effect<{ readonly ok: true }, { readonly code: string }> =>
        Effect.fail({ code: 'DECLINED' }),
      { output: outputSchema, error: failureSchema },
    )
    const flow = typedFailureV4.steps({ work: typedFailureV4.task(work) }, { start: 'work' })
    const run = createRun(flow, { context: {} })
    await run.start()
    await waitFor(() => run.getState().status === 'failed')
    const state = run.getState()
    const typedError = state.failure?.error as ErrorWithKind

    expect(state.status).toBe('failed')
    expect(typedError.kind).toBe('typed')
    expect(typedError.data).toEqual({ code: 'DECLINED' })
    await runner.dispose()
  })

  it('keeps defects and interruptions out of the typed data channel', async () => {
    const runner = makeEffectV4Runner(runtime())
    const failureKindsV4 = defineFlow({ name: 'failure-kinds-v4', context: boundary.trusted<{}>() })
    const defect = runner.task(
      (): Effect.Effect<{ readonly ok: true }> => Effect.die(new Error('bug')),
      { output: outputSchema, error: neverSchema },
    )
    const defectRun = createRun(
      failureKindsV4.steps({ work: failureKindsV4.task(defect) }, { start: 'work' }),
      {
        context: {},
      },
    )
    await defectRun.start()
    await waitFor(() => defectRun.getState().status === 'failed')
    const defectError = defectRun.getState().failure?.error as ErrorWithKind
    expect(defectError.kind).toBe('defect')
    expect(defectError.data).toBeUndefined()

    const interrupted = runner.task((): Effect.Effect<{ readonly ok: true }> => Effect.interrupt, {
      output: outputSchema,
      error: neverSchema,
    })
    const interruptedRun = createRun(
      failureKindsV4.steps({ work: failureKindsV4.task(interrupted) }, { start: 'work' }),
      {
        context: {},
      },
    )
    await interruptedRun.start()
    await waitFor(() => interruptedRun.getState().status === 'failed')
    const interruptedError = interruptedRun.getState().failure?.error as ErrorWithKind
    expect(interruptedError.kind).toBe('interrupted')
    expect(interruptedError.data).toBeUndefined()
    await runner.dispose()
  })

  it('maps FlowRun cancellation to v4 fiber interruption', async () => {
    const runner = makeEffectV4Runner(runtime())
    const cancelV4 = defineFlow({ name: 'cancel-v4', context: boundary.trusted<{}>() })
    const work = runner.task(
      () => Effect.sleep('10 seconds').pipe(Effect.as({ ok: true as const })),
      { output: outputSchema, error: neverSchema },
    )
    const run = createRun(cancelV4.steps({ work: cancelV4.task(work) }, { start: 'work' }), {
      context: {},
    })
    await run.start()
    await settle()
    await run.cancel('operator')
    const result = await run.awaitResult()
    expect(result.status).toBe('cancelled')
    await runner.dispose()
  })

  it('awaits an existing run with the v4 callback API', async () => {
    const runner = makeEffectV4Runner(runtime())
    const executeV4 = defineFlow({ name: 'execute-v4', context: boundary.trusted<{}>() })
    const work = runner.task(() => Effect.succeed({ ok: true as const }), {
      output: outputSchema,
      error: neverSchema,
    })
    const flow = executeV4.steps(
      {
        work: executeV4.task(work, { next: 'done' }),
        done: executeV4.final({ output: () => ({ done: true as const }) }),
      },
      { start: 'work' },
    )
    const run = createRun(flow, { context: {} })
    const result = await runEffect(execute(run))
    expect(result).toEqual({ done: true })
    await runner.dispose()
  })

  it('awaits a run directly and accepts asynchronous Standard Schema validation', async () => {
    const runner = makeEffectV4Runner(runtime())
    const asyncOutput = asyncSchema<{ readonly ok: true }>(async (value) =>
      value !== null && typeof value === 'object' && 'ok' in value && value.ok === true
        ? { ok: true }
        : undefined,
    )
    const asyncSchemaV4 = defineFlow({ name: 'async-schema-v4', context: boundary.trusted<{}>() })
    const work = runner.task(() => Effect.succeed({ ok: true as const }), {
      output: asyncOutput,
      error: neverSchema,
    })
    const flow = asyncSchemaV4.steps(
      { work: asyncSchemaV4.task(work, { next: 'done' }), done: asyncSchemaV4.final() },
      { start: 'work' },
    )
    const run = createRun(flow, { context: {} })
    const resultPromise = runEffect(awaitResult(run))
    await run.start()
    const result = await resultPromise
    expect(result).toBeUndefined()
    await runner.dispose()
  })
})

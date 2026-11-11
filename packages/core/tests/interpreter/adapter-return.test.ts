import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { createRunFailure, RUN_ADAPTER, RUN_FAILURE } from '../../src/authoring/run-adapter'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { defineWizard } from '../../src/wizard/define-wizard'
import { tick } from '../wizard/e2e/harness'

describe('callback-returned run adapters', () => {
  it.each(['resolve', 'reject'])(
    'starts adapter work only after the first thenable %s',
    async (first) => {
      let calls = 0
      const adapter = {
        [RUN_ADAPTER]: {
          run: () => ++calls,
          output: boundary.trusted<number>(),
        },
      }
      const wizard = defineWizard(
        { name: `returned-adapter-${first}-once`, context: z.object({}) },
        ({ step, steps }) =>
          steps({
            work: step({
              run: () => ({
                // biome-ignore lint/suspicious/noThenProperty: an adversarial thenable must not duplicate adapter side effects
                then(
                  accept: (value: typeof adapter) => unknown,
                  reject: (error: unknown) => unknown,
                ) {
                  if (first === 'reject') reject(new Error('first failure'))
                  else accept(adapter)
                  accept(adapter)
                },
              }),
            }),
          }),
      )
      const outcome = await wizard.run({})
      if (first === 'resolve') {
        expect(outcome).toMatchObject({ status: 'done', output: 1 })
        expect(calls).toBe(1)
      } else {
        expect(outcome).toMatchObject({
          status: 'halted',
          failure: { error: { message: 'first failure' } },
        })
        expect(calls).toBe(0)
      }
    },
  )

  it('does not start a synchronously resolved thenable adapter under strict sync', () => {
    let calls = 0
    const adapter = {
      [RUN_ADAPTER]: {
        run: () => {
          calls++
          return 1
        },
        output: boundary.trusted<number>(),
      },
    }
    const wizard = defineWizard(
      { name: 'returned-adapter-strict', context: z.object({}) },
      ({ step, steps }) =>
        steps({
          work: step({
            run: () => ({
              // biome-ignore lint/suspicious/noThenProperty: a synchronous custom thenable must still violate strict sync
              then(accept: (value: typeof adapter) => unknown) {
                accept(adapter)
              },
            }),
          }),
        }),
    )
    expect(() => wizard.runSync({})).toThrowError(
      expect.objectContaining({ code: 'SYNC_VIOLATION' }),
    )
    expect(calls).toBe(0)
  })

  it('runs synchronously with the exact callback args and the adapter output boundary', () => {
    let callbackArgs: object | undefined
    const wizard = defineWizard(
      {
        name: 'returned-adapter',
        context: z.object({ n: z.number() }),
        deps: boundary.trusted<{ extra: number }>(),
      },
      ({ step, steps }) => {
        const source = step({ run: () => 2 })
        return steps({
          source,
          work: step({
            needs: { source },
            run: (args) => {
              callbackArgs = args
              return {
                [RUN_ADAPTER]: {
                  run: (adapterArgs: typeof args) => {
                    expect(adapterArgs).toBe(callbackArgs)
                    return {
                      total:
                        adapterArgs.context.n + adapterArgs.deps.extra + adapterArgs.needs.source,
                    }
                  },
                  output: z
                    .object({ total: z.number() })
                    .transform(({ total }) => ({ total: total + 1 })),
                },
              }
            },
          }),
        })
      },
    )
    expect(wizard.runSync({ n: 3 }, { deps: { extra: 5 } })).toMatchObject({
      status: 'done',
      output: { total: 11 },
    })
  })

  it('awaits callback adapters per item and preserves concurrency and input order', async () => {
    const started: string[] = []
    const pending = new Map<string, (value: number) => void>()
    const wizard = defineWizard(
      { name: 'awaited-item-adapters', context: z.object({ ids: z.array(z.string()) }) },
      ({ step, steps }) =>
        steps({
          work: step({
            each: ({ context }) => context.ids,
            concurrency: 2,
            run: async (args) => {
              await Promise.resolve()
              return {
                [RUN_ADAPTER]: {
                  run: (adapterArgs: typeof args) => {
                    expect(adapterArgs).toBe(args)
                    started.push(adapterArgs.item)
                    return new Promise<number>((resolve) => pending.set(adapterArgs.item, resolve))
                  },
                  output: z.number().transform((value) => value * 10),
                },
              }
            },
          }),
        }),
    )
    const run = wizard.create({ ids: ['A', 'B', 'C'] })
    await run.start()
    await tick(4)
    expect(started).toEqual(['A', 'B'])
    pending.get('B')?.(2)
    await tick(8)
    expect(started).toEqual(['A', 'B', 'C'])
    pending.get('C')?.(3)
    pending.get('A')?.(1)
    expect(await run.awaitResult()).toMatchObject({ status: 'done', output: [10, 20, 30] })
    run.dispose()
  })

  it('uses an explicit step output instead of the returned adapter boundary', () => {
    let adapterParses = 0
    const wizard = defineWizard(
      { name: 'returned-output-override', context: z.object({}) },
      ({ step, steps }) =>
        steps({
          work: step({
            run: () => ({
              [RUN_ADAPTER]: {
                run: () => 7,
                output: boundary.parse(() => {
                  adapterParses++
                  throw new Error('adapter output must be overridden')
                }),
              },
            }),
            output: z.number().transform((value) => value + 10),
          }),
        }),
    )
    expect(wizard.runSync({})).toMatchObject({ status: 'done', output: 17 })
    expect(adapterParses).toBe(0)
  })

  it('retries typed adapter failures using their validated JSON data', async () => {
    let calls = 0
    const seen: unknown[] = []
    const scheduler = createTestScheduler({ now: 100 })
    const wizard = defineWizard(
      { name: 'returned-adapter-retry', context: z.object({}) },
      ({ step, steps }) =>
        steps({
          work: step({
            run: () => ({
              [RUN_ADAPTER]: {
                run: () => {
                  calls++
                  if (calls === 1)
                    throw createRunFailure('typed', new Error('busy'), { retry: true })
                  return 10
                },
                output: boundary.trusted<number>(),
              },
            }),
            retry: {
              retries: 1,
              when: (error) => {
                seen.push(error)
                return true
              },
            },
          }),
        }),
    )
    const run = wizard.create({}, { scheduler })
    await run.start()
    scheduler.flush()
    expect(await run.awaitResult()).toMatchObject({ status: 'done', output: 10 })
    expect(calls).toBe(2)
    expect(seen).toEqual([{ retry: true }])
    expect(run.log().find((event) => event.type === 'step.runFailed')).toMatchObject({
      failureKind: 'typed',
      error: { message: 'busy', data: { retry: true } },
    })
    run.dispose()
  })

  it('lets the step mapError override returned adapter failure data', () => {
    const wizard = defineWizard(
      { name: 'returned-error-override', context: z.object({}) },
      ({ step, steps }) =>
        steps({
          work: step({
            run: () => ({
              [RUN_ADAPTER]: {
                run: () => {
                  throw createRunFailure('typed', new Error('declined'), { source: 'adapter' })
                },
                output: boundary.trusted<number>(),
              },
            }),
            mapError: (error) => ({
              source: 'step',
              message: error instanceof Error ? error.message : String(error),
            }),
          }),
        }),
    )
    expect(wizard.runSync({})).toMatchObject({
      status: 'halted',
      failure: { error: { kind: 'typed', data: { source: 'step', message: 'declined' } } },
    })
  })

  it('rejects invalid returned adapter error data before retry or step error mapping', () => {
    let mappings = 0
    const wizard = defineWizard(
      { name: 'returned-invalid-error', context: z.object({}) },
      ({ step, steps }) =>
        steps({
          work: step({
            run: () => ({
              [RUN_ADAPTER]: {
                run: () => {
                  throw {
                    [RUN_FAILURE]: true,
                    kind: 'typed',
                    error: new Error('bad data'),
                    data: { amount: 1n },
                  }
                },
                output: boundary.trusted<number>(),
              },
            }),
            mapError: () => {
              mappings++
              return { hidden: true }
            },
            retry: { retries: 3 },
          }),
        }),
    )
    expect(wizard.runSync({})).toMatchObject({
      status: 'halted',
      failure: { error: { code: 'INVALID_RUN_ERROR', kind: 'defect' } },
    })
    expect(mappings).toBe(0)
  })

  it('does not start an awaited adapter after its callback timed out', async () => {
    let release = (): void => {}
    let calls = 0
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const scheduler = createTestScheduler({ now: 100 })
    const wizard = defineWizard(
      { name: 'returned-adapter-timeout', context: z.object({}) },
      ({ step, steps }) =>
        steps({
          work: step({
            timeout: 10,
            run: async () => {
              await gate
              return {
                [RUN_ADAPTER]: {
                  run: () => {
                    calls++
                    return 1
                  },
                  output: boundary.trusted<number>(),
                },
              }
            },
          }),
        }),
    )
    const run = wizard.create({}, { scheduler })
    await run.start()
    scheduler.advance(10)
    expect(run.getState().status).toBe('halted')
    expect(run.getState().steps.work.error).toMatchObject({ code: 'TIMEOUT' })
    release()
    await tick(4)
    expect(calls).toBe(0)
    expect(run.getState().steps.work.error).toMatchObject({ code: 'TIMEOUT' })
    run.dispose()
  })
})

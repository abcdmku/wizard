import { describe, expect, it } from 'vitest'
import { RUN_FAILURE } from '../../src/authoring/run-adapter'
import { createExecutor } from '../../src/interpreter/executor'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import type { Message, ResultToken } from '../../src/machine/commands'
import type { CallEffect } from '../../src/machine/effects'
import { flow, initialState, testEnv } from '../helpers/fake-machine'

function harness(def: ReturnType<typeof flow>) {
  const scheduler = createTestScheduler({ now: 100 })
  const state = initialState(testEnv(def), { instanceId: 'errors', context: {}, now: 100 })
  const sent: Message[] = []
  const executor = createExecutor({
    def,
    path: [],
    instanceId: 'errors',
    clock: scheduler,
    scheduler,
    getState: () => state,
    send: (msg) => sent.push(msg),
    progress: () => {},
  })
  const execute = (
    hook: CallEffect['hook'],
    token: ResultToken = { step: 'work', runId: 1, attempt: 1 },
    extra?: Readonly<Record<string, unknown>>,
  ) =>
    executor.execute({
      kind: 'call',
      effectId: `effect-${sent.length}`,
      hook,
      step: 'work',
      token,
      ...(extra !== undefined ? { extra } : {}),
    })
  return { execute, sent, executor }
}

describe('durable error data', () => {
  it.each([{ code: 'DECLINED', details: [false, null, 3] }, null])(
    'preserves JSON adapter data in the failure and retry predicate: %j',
    (data) => {
      const seen: unknown[] = []
      const def = flow({
        steps: {
          work: {
            kind: 'step',
            hooks: {
              run: () => {
                throw { [RUN_FAILURE]: true, kind: 'typed', error: new Error('declined'), data }
              },
            },
            retry: {
              retries: 1,
              when: (error) => {
                seen.push(error)
                return false
              },
            },
          },
        },
      })
      const { execute, sent } = harness(def)
      execute('run')
      expect(sent[0]).toMatchObject({
        type: 'res.err',
        error: { name: 'Error', message: 'declined', data },
        failure: { kind: 'typed', data },
      })
      expect(seen).toEqual([data])
    },
  )

  it('rejects invalid adapter data as a defect without storing the invalid value', () => {
    const def = flow({
      steps: {
        work: {
          kind: 'step',
          hooks: {
            run: () => {
              throw {
                [RUN_FAILURE]: true,
                kind: 'typed',
                error: new Error('original'),
                data: { amount: 1n },
              }
            },
          },
        },
      },
    })
    const { execute, sent } = harness(def)
    execute('run')
    const msg = sent[0]
    expect(msg).toMatchObject({
      type: 'res.err',
      retryable: false,
      error: {
        name: 'RunErrorDataError',
        code: 'INVALID_RUN_ERROR',
        message: "run adapter of step 'work' returned a non-JSON value at .amount: is a bigint",
      },
      failure: { kind: 'defect' },
    })
    if (msg?.type !== 'res.err') throw new Error('expected rejected adapter data')
    expect(msg.error).not.toHaveProperty('data')
    expect(msg.failure).not.toHaveProperty('data')
    expect(() => JSON.stringify(msg)).not.toThrow()
  })

  it('rejects an adapter failure whose data getter throws', () => {
    const def = flow({
      steps: {
        work: {
          kind: 'step',
          hooks: {
            run: () => {
              throw {
                [RUN_FAILURE]: true,
                kind: 'typed',
                error: new Error('original'),
                get data(): unknown {
                  throw new Error('unreadable')
                },
              }
            },
          },
        },
      },
    })
    const { execute, sent } = harness(def)
    expect(() => execute('run')).not.toThrow()
    expect(sent[0]).toMatchObject({
      type: 'res.err',
      retryable: false,
      error: { code: 'INVALID_RUN_ERROR' },
      failure: { kind: 'defect' },
    })
  })

  it.each([
    { value: undefined, detail: '<root>: is undefined' },
    { value: { values: [undefined] }, detail: '.values[0]: is undefined' },
    { value: { n: Number.NaN }, detail: '.n: is not a finite number' },
    { value: new Date(0), detail: '<root>: is a Date (not a plain object)' },
  ])('rejects a mapError result at $detail before retry.when runs', ({ value, detail }) => {
    const seen: unknown[] = []
    const def = flow({
      steps: {
        work: {
          kind: 'step',
          hooks: { mapError: () => value },
          retry: {
            retries: 3,
            when: (error) => {
              seen.push(error)
              return true
            },
          },
        },
      },
    })
    const { execute, sent, executor } = harness(def)
    execute('mapError')
    expect(sent[0]).toMatchObject({
      type: 'res.err',
      retryable: false,
      error: {
        name: 'MapErrorDataError',
        code: 'INVALID_MAP_ERROR',
        message: `mapError of step 'work' returned a non-JSON value at ${detail}`,
      },
    })
    expect(seen).toEqual([])
    expect(executor.inflight()).toBe(0)
  })

  it('checks asynchronous mapper results before accepting them', async () => {
    const def = flow({
      steps: { work: { kind: 'step', hooks: { mapError: async () => 1n } } },
    })
    const { execute, sent } = harness(def)
    execute('mapError')
    await Promise.resolve()
    expect(sent[0]).toMatchObject({
      type: 'res.err',
      async: true,
      error: { code: 'INVALID_MAP_ERROR' },
    })
  })

  it('reports unreadable mapper data as a failure instead of throwing from the executor', () => {
    const value = {
      get detail(): unknown {
        throw new Error('getter broke')
      },
    }
    const def = flow({
      steps: { work: { kind: 'step', hooks: { mapError: () => value } } },
    })
    const { execute, sent } = harness(def)
    expect(() => execute('mapError')).not.toThrow()
    expect(sent[0]).toMatchObject({
      type: 'res.err',
      error: {
        code: 'INVALID_MAP_ERROR',
        message:
          "mapError of step 'work' returned a non-JSON value: its properties could not be read",
      },
    })
  })

  it('maps each concurrent item with its own raw failure, even when mappings run in reverse', () => {
    const def = flow({
      steps: {
        work: {
          kind: 'step',
          hooks: {
            run: ({ item }) => {
              throw new Error(`item ${item}`)
            },
            mapError: ({ error }) => ({ message: (error as Error).message }),
          },
        },
      },
    })
    const { execute, sent } = harness(def)
    const first = { step: 'work', runId: 1, itemIndex: 0, attempt: 1 }
    const second = { step: 'work', runId: 1, itemIndex: 1, attempt: 1 }
    execute('run', first, { item: 'A', index: 0 })
    execute('run', second, { item: 'B', index: 1 })
    execute('mapError', second)
    execute('mapError', first)
    expect(sent.slice(2)).toMatchObject([
      { type: 'res.ok', value: { message: 'item B' } },
      { type: 'res.ok', value: { message: 'item A' } },
    ])
  })
})

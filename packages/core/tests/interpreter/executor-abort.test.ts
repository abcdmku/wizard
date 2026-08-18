/**
 * Hook executor — extra echo, hostile thenables, timeouts / abort, and error serialization.
 */
import { describe, expect, it } from 'vitest'
import { toSerializedError } from '../../src/interpreter/errors'
import { createExecutor } from '../../src/interpreter/executor'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import type { Message } from '../../src/machine/commands'
import type { CallEffect } from '../../src/machine/effects'
import type { WizardState } from '../../src/machine/state'
import { flow, initialState, testEnv } from '../helpers/fake-machine'

function harness(
  def: ReturnType<typeof flow>,
  patch: (s: WizardState) => WizardState = (s) => s,
  strict?: 'sync',
) {
  const sched = createTestScheduler({ now: 100 })
  const menv = testEnv(def)
  const state = patch(initialState(menv, { instanceId: 'inst', context: { c: 1 }, now: 100 }))
  const sent: Array<{ msg: Message; causedBy: number | undefined }> = []
  const executor = createExecutor({
    def,
    path: ['root'],
    instanceId: 'inst',
    clock: sched,
    scheduler: sched,
    deps: { api: 'svc' },
    ...(strict ? { strict } : {}),
    abortGraceMs: 1_000,
    getState: () => state,
    send: (msg, causedBy) => sent.push({ msg, causedBy }),
  })
  return { executor, sent, sched, state }
}

const activate =
  (id: string, extra: Partial<WizardState['steps'][string]> = {}) =>
  (s: WizardState): WizardState => ({
    ...s,
    steps: {
      ...s.steps,
      [id]: { ...s.steps[id]!, status: 'active', runId: 3, attempt: 2, ...extra },
    },
  })

const call = (
  step: string,
  hook: CallEffect['hook'],
  extra: Partial<CallEffect> = {},
): CallEffect => ({
  kind: 'call',
  effectId: 'fx1',
  step,
  hook,
  token: { step, runId: 3, attempt: 2 },
  ...extra,
})

describe('executor: extra echo and hostile thenables', () => {
  it("echoes CallEffect.extra on res.ok and res.err (an 'on' handler's event/payload/inboxId come back)", async () => {
    const def = flow({
      steps: {
        w: {
          kind: 'wait',
          hooks: {
            on: {
              ok: () => ({ next: 'x' }),
              boom: () => {
                throw new Error('handler failed')
              },
              late: () => Promise.reject(new Error('later')),
            },
          },
        },
      },
    })
    const { executor, sent } = harness(def, activate('w'))
    const extra = { event: 'ok', payload: { id: 1 }, inboxId: 'evt_1' }
    executor.execute(call('w', 'on', { extra }))
    expect(sent[0]!.msg).toMatchObject({ type: 'res.ok', value: { next: 'x' }, extra })
    const extraErr = { event: 'boom', payload: 2, inboxId: 'evt_2' }
    executor.execute({ ...call('w', 'on', { extra: extraErr }), effectId: 'fx2' })
    expect(sent[1]!.msg).toMatchObject({ type: 'res.err', extra: extraErr })
    const extraLate = { event: 'late', payload: 3, inboxId: 'evt_3' }
    executor.execute({ ...call('w', 'on', { extra: extraLate }), effectId: 'fx3' })
    await Promise.resolve()
    await Promise.resolve()
    expect(sent[2]!.msg).toMatchObject({ type: 'res.err', extra: extraLate })
    // Effects without extra do not grow an `extra` key.
    executor.execute({
      kind: 'call',
      effectId: 'fx4',
      step: 'w',
      hook: 'on',
      token: { step: 'w', runId: 3 },
    })
    expect('extra' in (sent[3]!.msg as object)).toBe(false)
  })

  it('a throwing `then` getter is reported as res.err, never thrown out of execute()', () => {
    const def = flow({
      steps: {
        t: {
          kind: 'task',
          hooks: {
            run: () => ({
              // biome-ignore lint/suspicious/noThenProperty: intentionally hostile thenable
              get then() {
                throw new Error('hostile getter')
              },
            }),
          },
        },
      },
    })
    const { executor, sent } = harness(def, activate('t'))
    expect(() => executor.execute(call('t', 'run'))).not.toThrow()
    expect(sent[0]!.msg).toMatchObject({ type: 'res.err', error: { message: 'hostile getter' } })
    expect(executor.inflight()).toBe(0)
  })

  it('a thenable whose then() throws is reported once as res.err', () => {
    const def = flow({
      steps: {
        t: {
          kind: 'task',
          hooks: {
            run: () => ({
              // biome-ignore lint/suspicious/noThenProperty: intentionally hostile thenable
              then() {
                throw new Error('then exploded')
              },
            }),
          },
        },
      },
    })
    const { executor, sent } = harness(def, activate('t'))
    expect(() => executor.execute(call('t', 'run'))).not.toThrow()
    expect(sent).toHaveLength(1)
    expect(sent[0]!.msg).toMatchObject({ type: 'res.err', error: { message: 'then exploded' } })
  })

  it('a custom thenable that settles synchronously and repeatedly still yields exactly one report', () => {
    const def = flow({
      steps: {
        t: {
          kind: 'task',
          hooks: {
            run: () => ({
              // biome-ignore lint/suspicious/noThenProperty: intentionally synchronous custom thenable
              then(onOk: (v: unknown) => void, onErr: (e: unknown) => void) {
                onOk('first')
                onOk('second')
                onErr(new Error('third'))
              },
            }),
          },
        },
      },
    })
    const { executor, sent } = harness(def, activate('t'))
    executor.execute(call('t', 'run'))
    expect(sent).toHaveLength(1)
    expect(sent[0]!.msg).toMatchObject({ type: 'res.ok', value: 'first' })
  })

  it("strict: 'sync' swallows a hostile thenable's then() and reports the violation once", () => {
    const def = flow({
      steps: {
        t: {
          kind: 'task',
          hooks: {
            run: () => ({
              // biome-ignore lint/suspicious/noThenProperty: intentionally hostile thenable
              then() {
                throw new Error('cannot subscribe')
              },
            }),
          },
        },
      },
    })
    const { executor, sent } = harness(def, activate('t'), 'sync')
    executor.execute(call('t', 'run'))
    expect(sent).toHaveLength(1)
    expect(sent[0]!.msg).toMatchObject({ type: 'res.err', syncViolation: true })
  })
})

describe('executor: timeout and abort', () => {
  it('times out with res.err { timedOut } and aborts the signal; late results are dropped', async () => {
    let resolveIt: (v: unknown) => void = () => {}
    let signal: AbortSignal | undefined
    const def = flow({
      steps: {
        t: {
          kind: 'task',
          hooks: {
            run: (a) => {
              signal = a.signal
              return new Promise((r) => (resolveIt = r))
            },
          },
        },
      },
    })
    const { executor, sent, sched } = harness(def, activate('t'))
    executor.execute(call('t', 'run', { timeoutMs: 250 }))
    sched.advance(250)
    expect(signal?.aborted).toBe(true)
    expect(sent[0]!.msg).toMatchObject({
      type: 'res.err',
      timedOut: true,
      durationMs: 250,
      error: { code: 'TIMEOUT' },
    })
    resolveIt('late')
    await Promise.resolve()
    expect(sent).toHaveLength(1)
  })

  it('abort(step) aborts the signal but lets a late success through as res.ok', async () => {
    let resolveIt: (v: unknown) => void = () => {}
    const def = flow({
      steps: { t: { kind: 'task', hooks: { run: () => new Promise((r) => (resolveIt = r)) } } },
    })
    const { executor, sent } = harness(def, activate('t'))
    executor.execute(call('t', 'run'))
    executor.abort('t', 'cancelled')
    resolveIt('made it anyway')
    await Promise.resolve()
    expect(sent[0]!.msg).toMatchObject({ type: 'res.ok', value: 'made it anyway' })
  })

  it('abort(step) reports a rejection as res.err { cancelled }', async () => {
    let signal: AbortSignal | undefined
    const def = flow({
      steps: {
        t: {
          kind: 'task',
          hooks: {
            run: (a) => {
              signal = a.signal
              return new Promise((_, rej) =>
                a.signal.addEventListener('abort', () => rej(a.signal.reason)),
              )
            },
          },
        },
      },
    })
    const { executor, sent } = harness(def, activate('t'))
    executor.execute(call('t', 'run'))
    executor.abort('t', 'user cancelled')
    expect(signal?.aborted).toBe(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(sent[0]!.msg).toMatchObject({
      type: 'res.err',
      cancelled: true,
      error: { name: 'AbortError', message: 'user cancelled' },
    })
  })

  it('abort(step) without a timeout arms the grace timer; abortAll silences everything', () => {
    const def = flow({
      steps: { t: { kind: 'task', hooks: { run: () => new Promise(() => {}) } } },
    })
    const { executor, sent, sched } = harness(def, activate('t'))
    executor.execute(call('t', 'run'))
    executor.abort('t')
    sched.advance(999)
    expect(sent).toHaveLength(0)
    sched.advance(1)
    expect(sent[0]!.msg).toMatchObject({ type: 'res.err', cancelled: true, timedOut: true })

    executor.execute({ ...call('t', 'run'), effectId: 'fx2' })
    executor.abortAll()
    expect(executor.inflight()).toBe(0)
    sched.advance(10_000)
    expect(sent).toHaveLength(1)
  })
})

describe('toSerializedError', () => {
  it('handles Error, coded objects and primitives', () => {
    expect(toSerializedError(new RangeError('r'))).toEqual({ name: 'RangeError', message: 'r' })
    expect(toSerializedError({ name: 'X', message: 'm', code: 'C' })).toEqual({
      name: 'X',
      message: 'm',
      code: 'C',
    })
    expect(toSerializedError('plain')).toEqual({ name: 'Error', message: 'plain' })
    expect(toSerializedError(undefined)).toEqual({ name: 'Error', message: 'undefined' })
  })
})

import { describe, expect, it } from 'vitest'
import type { HookArgs } from '../../src/authoring/compiled'
import { buildHookArgs, createExecutor, toSerializedError } from '../../src/interpreter/executor'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import type { Message } from '../../src/machine/commands'
import type { CallEffect } from '../../src/machine/effects'
import type { WizardState } from '../../src/machine/state'
import { flow, initialState, stringsBoundary, testEnv } from '../helpers/fake-machine'

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

describe('executor: hook args', () => {
  it('builds HookArgs from state + step + extras (extras override base fields)', () => {
    const def = flow({ steps: { t: { kind: 'task', hooks: { run: () => 1 } } } })
    const state = activate('t', { input: { draft: 1 }, output: 'prev' })(
      initialState(testEnv(def), { instanceId: 'inst', context: { c: 1 }, now: 0 }),
    )
    const update = () => {}
    const args = buildHookArgs({
      def,
      path: ['p'],
      instanceId: 'inst',
      deps: { d: 1 },
      state,
      step: 't',
      signal: new AbortController().signal,
      update,
      extra: { from: 'a', output: 'override' },
    })
    expect(args).toMatchObject({
      step: 't',
      path: ['p'],
      context: { c: 1 },
      deps: { d: 1 },
      input: { draft: 1 },
      output: 'override',
      attempt: 2,
      runId: 3,
      idempotencyKey: 'inst:t:3',
      from: 'a',
    })
    expect(args.steps).toBe(state.steps)
    expect(args.update).toBe(update)
    expect(args.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('executor: sync and async results', () => {
  it('reports a sync return value as res.ok immediately with the effect token and causedBy', () => {
    let received: HookArgs | undefined
    const def = flow({
      steps: {
        t: {
          kind: 'task',
          hooks: {
            run: (a) => {
              received = a
              return { v: a.attempt }
            },
          },
        },
      },
    })
    const { executor, sent } = harness(def, activate('t'))
    executor.execute(call('t', 'run', { extra: { attempt: 2 } }), 7)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.causedBy).toBe(7)
    expect(sent[0]!.msg).toEqual({
      type: 'res.ok',
      effectId: 'fx1',
      hook: 'run',
      token: { step: 't', runId: 3, attempt: 2 },
      value: { v: 2 },
      durationMs: 0,
      extra: { attempt: 2 },
    })
    expect(received?.deps).toEqual({ api: 'svc' })
    expect(received?.idempotencyKey).toBe('inst:t:3')
    expect(executor.inflight()).toBe(0)
  })

  it('serializes a sync throw into res.err (name/message/code, no stack)', () => {
    const def = flow({
      steps: {
        t: {
          kind: 'task',
          hooks: {
            run: () => {
              throw Object.assign(new Error('boom'), { code: 'E_BOOM' })
            },
          },
        },
      },
    })
    const { executor, sent } = harness(def, activate('t'))
    executor.execute(call('t', 'run'))
    expect(sent[0]!.msg).toMatchObject({
      type: 'res.err',
      error: { name: 'Error', message: 'boom', code: 'E_BOOM' },
    })
    expect(Object.keys((sent[0]!.msg as any).error)).not.toContain('stack')
  })

  it('reports an async result later, measuring durationMs with the injected clock', async () => {
    let resolveIt: (v: unknown) => void = () => {}
    const def = flow({
      steps: { t: { kind: 'task', hooks: { run: () => new Promise((r) => (resolveIt = r)) } } },
    })
    const { executor, sent, sched } = harness(def, activate('t'))
    executor.execute(call('t', 'run'))
    expect(sent).toHaveLength(0)
    expect(executor.inflight()).toBe(1)
    sched.advance(40)
    resolveIt('done')
    await Promise.resolve()
    expect(sent[0]!.msg).toMatchObject({ type: 'res.ok', value: 'done', durationMs: 40 })
    expect(executor.inflight()).toBe(0)
  })

  it('reports an async rejection as res.err', async () => {
    const def = flow({
      steps: { t: { kind: 'task', hooks: { run: () => Promise.reject(new TypeError('bad')) } } },
    })
    const { executor, sent } = harness(def, activate('t'))
    executor.execute(call('t', 'run'))
    await Promise.resolve()
    await Promise.resolve()
    expect(sent[0]!.msg).toMatchObject({
      type: 'res.err',
      error: { name: 'TypeError', message: 'bad' },
    })
  })

  it("strict: 'sync' reports a thenable as res.err { syncViolation } and swallows the promise", async () => {
    const def = flow({
      steps: { t: { kind: 'task', hooks: { run: () => Promise.reject(new Error('later')) } } },
    })
    const { executor, sent } = harness(def, activate('t'), 'sync')
    executor.execute(call('t', 'run'))
    expect(sent).toHaveLength(1)
    expect(sent[0]!.msg).toMatchObject({
      type: 'res.err',
      syncViolation: true,
      error: { name: 'WizardError', code: 'SYNC_VIOLATION' },
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(sent).toHaveLength(1)
  })
})

describe('executor: boundaries', () => {
  it('parseInput runs the view input boundary over the draft and returns the parsed value', () => {
    const def = flow({ steps: { v: { kind: 'view', input: stringsBoundary('name') } } })
    const { executor, sent } = harness(def, activate('v', { input: { name: 'ann', extra: 1 } }))
    executor.execute(call('v', 'parseInput'))
    expect(sent[0]!.msg).toMatchObject({
      type: 'res.ok',
      hook: 'parseInput',
      value: { name: 'ann', extra: 1 },
    })
  })

  it('parseInput reports boundary issues as res.err { issues }', () => {
    const def = flow({ steps: { v: { kind: 'view', input: stringsBoundary('name') } } })
    const { executor, sent } = harness(def, activate('v', { input: { name: 42 } }))
    executor.execute(call('v', 'parseInput'))
    expect(sent[0]!.msg).toMatchObject({
      type: 'res.err',
      hook: 'parseInput',
      error: { name: 'BoundaryRejection' },
      issues: [{ message: 'name must be a string', path: ['name'] }],
    })
  })

  it('parseInput without an input boundary passes the draft through', () => {
    const def = flow({ steps: { v: { kind: 'view' } } })
    const { executor, sent } = harness(def, activate('v', { input: 'raw' }))
    executor.execute(call('v', 'parseInput'))
    expect(sent[0]!.msg).toMatchObject({ type: 'res.ok', value: 'raw' })
  })

  it('run pipes the hook value through the output boundary (sync and async)', async () => {
    const def = flow({
      steps: {
        ok: { kind: 'task', hooks: { run: () => ({ id: 'x' }) }, output: stringsBoundary('id') },
        bad: {
          kind: 'task',
          hooks: { run: async () => ({ id: 7 }) },
          output: stringsBoundary('id'),
        },
      },
    })
    const { executor, sent } = harness(def, (s) => activate('bad')(activate('ok')(s)))
    executor.execute(call('ok', 'run'))
    expect(sent[0]!.msg).toMatchObject({ type: 'res.ok', value: { id: 'x' } })
    executor.execute({ ...call('bad', 'run'), effectId: 'fx2' })
    await Promise.resolve()
    await Promise.resolve()
    expect(sent[1]!.msg).toMatchObject({
      type: 'res.err',
      effectId: 'fx2',
      issues: [{ message: 'id must be a string' }],
    })
  })
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

describe('executor: child context boundary', () => {
  const child = (parse: (v: unknown) => any) =>
    flow({
      name: 'child',
      context: { kind: 'parse', parse },
      steps: { c: { kind: 'view' } },
    })

  it('pipes the childContext value through the child flow context boundary (transformed value wins)', () => {
    const def = flow({
      steps: {
        f: {
          kind: 'flow',
          child: child((v) => ({ ok: true, value: { ...(v as object), normalized: true } })),
          hooks: { childContext: ({ context }: any) => ({ tenant: context.c }) },
        },
      },
    })
    const { executor, sent } = harness(def, activate('f'))
    executor.execute(call('f', 'childContext'))
    expect(sent[0]!.msg).toMatchObject({ type: 'res.ok', value: { tenant: 1, normalized: true } })
  })

  it('reports a rejected child context as res.err with the boundary issues (sync and async)', async () => {
    const reject = () => ({ ok: false, issues: [{ message: 'tenant required' }] })
    const def = flow({
      steps: {
        f: { kind: 'flow', child: child(reject), hooks: { childContext: () => ({}) } },
        g: { kind: 'flow', child: child(reject), hooks: { childContext: async () => ({}) } },
      },
    })
    const { executor, sent } = harness(def, (s) => activate('g')(activate('f')(s)))
    executor.execute(call('f', 'childContext'))
    expect(sent[0]!.msg).toMatchObject({
      type: 'res.err',
      issues: [{ message: 'tenant required' }],
    })
    executor.execute({ ...call('g', 'childContext'), effectId: 'fx2' })
    await Promise.resolve()
    await Promise.resolve()
    expect(sent[1]!.msg).toMatchObject({
      type: 'res.err',
      effectId: 'fx2',
      issues: [{ message: 'tenant required' }],
    })
  })

  it("strict: 'sync' treats an async child context boundary as a violation", () => {
    const def = flow({
      steps: {
        f: {
          kind: 'flow',
          child: child(async (v: unknown) => ({ ok: true, value: v })),
          hooks: { childContext: () => ({}) },
        },
      },
    })
    const { executor, sent } = harness(def, activate('f'), 'sync')
    executor.execute(call('f', 'childContext'))
    expect(sent[0]!.msg).toMatchObject({ type: 'res.err', syncViolation: true })
  })
})

describe('executor: hook resolution', () => {
  it("'on' resolves hooks.on[extra.event]; a missing handler is a HOOK_MISSING error", () => {
    const def = flow({
      steps: {
        w: {
          kind: 'wait',
          hooks: { on: { ping: ({ payload }) => ({ done: { echoed: payload } }) } },
        },
      },
    })
    const { executor, sent } = harness(def, activate('w'))
    executor.execute(call('w', 'on', { extra: { event: 'ping', payload: 5 } }))
    expect(sent[0]!.msg).toMatchObject({ type: 'res.ok', value: { done: { echoed: 5 } } })
    executor.execute({ ...call('w', 'on', { extra: { event: 'nope' } }), effectId: 'fx2' })
    expect(sent[1]!.msg).toMatchObject({ type: 'res.err', error: { code: 'HOOK_MISSING' } })
  })

  it('unknown steps and missing hooks fail fast with coded errors', () => {
    const def = flow({ steps: { t: { kind: 'task' } } })
    const { executor, sent } = harness(def, activate('t'))
    executor.execute(call('ghost', 'run'))
    expect(sent[0]!.msg).toMatchObject({ type: 'res.err', error: { code: 'UNKNOWN_STEP' } })
    executor.execute({ ...call('t', 'compensate'), effectId: 'fx2' })
    expect(sent[1]!.msg).toMatchObject({ type: 'res.err', error: { code: 'HOOK_MISSING' } })
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

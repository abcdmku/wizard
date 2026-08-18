import { describe, expect, it } from 'vitest'
import type { HookArgs } from '../../src/authoring/compiled'
import { createExecutor } from '../../src/interpreter/executor'
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

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { compile } from '../../src/authoring/compile'
import type { CompiledStep, HookArgs } from '../../src/authoring/compiled'
import { defineFlow } from '../../src/authoring/define-flow'
import { WizardError } from '../../src/errors'

type Any = any

function issuesOf(fn: () => unknown): string[] {
  try {
    fn()
  } catch (error) {
    if (error instanceof WizardError) return (error.issues ?? []).map((i) => i.message)
    throw error
  }
  throw new Error('expected a WizardError')
}

const args = (extra: Record<string, unknown> = {}): HookArgs =>
  ({
    step: 's',
    path: [],
    context: {},
    deps: undefined,
    input: undefined,
    output: undefined,
    steps: {},
    signal: new AbortController().signal,
    attempt: 1,
    runId: 1,
    idempotencyKey: 'k',
    update: () => {},
    ...extra,
  }) as HookArgs

describe('compile: output shape', () => {
  const s = defineFlow({
    name: 'shape',
    version: 2,
    context: z.object({ a: z.string() }),
    events: { ping: z.object({ n: z.number() }) },
    deps: boundary.trusted<{ log: (m: string) => void }>(),
    onFailure: 'compensate',
    retry: { attempts: 1, backoff: 1000 },
    autoRun: 'manual',
    concurrency: 3,
    unmatchedEvents: { buffer: false, ttl: '1m' },
  })
  const child = defineFlow({ name: 'child', context: z.object({ n: z.number() }) })
  const childFlow = child.steps({ end: child.final({ output: ({ context }) => context.n }) })

  const flow = s.steps(
    {
      form: s.view({
        label: 'Form',
        input: z.object({ qty: z.string().transform(Number) }),
        initial: { qty: '1' },
        validate: ({ output }) => (output.qty > 0 ? undefined : [{ message: 'qty' }]),
        canEnter: () => true,
        canExit: () => true,
        enter: () => {},
        exit: () => {},
        next: 'work',
      }),
      work: s.task(async () => ({ id: 1 }), {
        output: z.object({ id: z.number() }),
        retry: { attempts: 3, backoff: 'exponential', baseMs: 100, factor: 3, maxBackoffMs: 2000 },
        timeout: '5s',
        compensate: () => {},
        next: ({ output }) => (output.id > 0 ? 'wait' : null),
      }),
      wait: s.wait({
        on: { ping: ({ payload }) => ({ next: payload.n > 0 ? 'route' : undefined }) },
        timeout: { after: '15m', next: 'sub' },
        next: 'route',
      }),
      route: s.decision({ next: () => ['sub', 'sub2'] }),
      sub: s.flow(childFlow, {
        context: () => ({ n: 1 }),
        output: z.number(),
        next: 'done',
        dependsOn: ['work'],
      }),
      sub2: s.flow(childFlow, {
        context: () => ({ n: 2 }),
        next: 'done',
        dependsOn: { any: ['work', 'wait'] },
      }),
      done: s.final({ output: ({ context }) => context.a }),
    },
    { start: 'form' },
  )
  const def = compile(flow)

  it('flow-level fields, policies with conversions and defaults, identity, cache', () => {
    expect(def.name).toBe('shape')
    expect(def.version).toBe(2)
    expect(def.order).toEqual(['form', 'work', 'wait', 'route', 'sub', 'sub2', 'done'])
    expect(def.start).toEqual(['form'])
    expect(def.context.kind).toBe('standard')
    expect(def.deps?.kind).toBe('trusted')
    expect(Object.keys(def.events)).toEqual(['ping'])
    expect(def.policies).toEqual({
      onFailure: 'compensate',
      retry: { attempts: 1, backoff: 1000 },
      autoRun: 'manual',
      concurrency: 3,
      unmatchedEvents: { buffer: false, ttlMs: 60_000 },
    })
    expect(def.identity).toBe(flow)
    expect(compile(flow)).toBe(def)
  })

  it('defaults: version 1, start = first step, halt/ready/Infinity/buffer 5m', () => {
    const b = defineFlow({ name: 'd', context: boundary.trusted() })
    const d = compile(b.steps({ a: b.final() }))
    expect(d.version).toBe(1)
    expect(d.start).toEqual(['a'])
    expect(d.policies).toEqual({
      onFailure: 'halt',
      autoRun: 'ready',
      concurrency: Number.POSITIVE_INFINITY,
      unmatchedEvents: { buffer: true, ttlMs: 300_000 },
    })
  })

  it('view: input/initial boundaries, hooks (validate maps input → output), static next', () => {
    const form = def.steps.form as CompiledStep
    expect(form.kind).toBe('view')
    expect(form.label).toBe('Form')
    expect(form.next).toEqual({ kind: 'static', targets: ['work'] })
    expect(form.input?.kind).toBe('standard')
    expect(form.initial).toEqual({ qty: '1' })
    expect(Object.keys(form.hooks).sort()).toEqual([
      'canEnter',
      'canExit',
      'enter',
      'exit',
      'validate',
    ])
    expect(form.hooks.validate?.(args({ input: { qty: 0 } }))).toEqual([{ message: 'qty' }])
    expect(form.hooks.validate?.(args({ input: { qty: 2 } }))).toBeUndefined()
    expect(form.expose).toEqual({ input: false, output: false })
    expect('dependsOn' in form).toBe(false)
  })

  it('task: run/output/retry/timeoutMs/compensate (reason null → undefined), dynamic next', async () => {
    const work = def.steps.work as CompiledStep
    expect(work.kind).toBe('task')
    expect(work.next).toEqual({ kind: 'dynamic' })
    expect(await work.hooks.run?.(args())).toEqual({ id: 1 })
    expect(work.output?.kind).toBe('standard')
    expect(work.retry).toEqual({
      attempts: 3,
      backoff: 'exponential',
      baseMs: 100,
      factor: 3,
      maxBackoffMs: 2000,
    })
    expect(work.timeoutMs).toBe(5000)
    expect(await work.hooks.next?.(args({ output: { id: 1 } }))).toBe('wait')
    expect(await work.hooks.next?.(args({ output: { id: 0 } }))).toBeNull()
    let seenReason: unknown = 'not-called'
    const cb = defineFlow({ name: 'c', context: boundary.trusted() })
    const c = compile(
      cb.steps({
        t: cb.task(async () => 1, {
          compensate: ({ reason }) => {
            seenReason = reason
          },
        }),
      }),
    )
    c.steps.t?.hooks.compensate?.(args({ output: 1, reason: null }))
    expect(seenReason).toBeUndefined()
    c.steps.t?.hooks.compensate?.(args({ output: 1, reason: 'cancelled' }))
    expect(seenReason).toBe('cancelled')
  })

  it('wait: on handlers are compiled RAW (the machine applies the contract), waitTimeout in ms', async () => {
    const wait = def.steps.wait as CompiledStep
    expect(wait.kind).toBe('wait')
    expect(wait.waitTimeout).toEqual({ afterMs: 900_000, next: 'sub' })
    expect(Object.keys(wait.hooks.on ?? {})).toEqual(['ping'])
    const on = wait.hooks.on?.ping
    expect(await on?.(args({ event: 'ping', payload: { n: 1 } }))).toEqual({ next: 'route' })
    expect(await on?.(args({ event: 'ping', payload: { n: 0 } }))).toEqual({ next: undefined })
  })

  it('flow: child compiled, RAW context/deps mappers (the boundary runs once, at child creation), childOutput boundary, dependsOn', async () => {
    const sub = def.steps.sub as CompiledStep
    expect(sub.kind).toBe('flow')
    expect(sub.child?.name).toBe('child')
    expect(sub.child?.identity).toBe(childFlow)
    expect(sub.dependsOn).toEqual({ all: ['work'] })
    expect((def.steps.sub2 as CompiledStep).dependsOn).toEqual({ any: ['work', 'wait'] })
    expect(await sub.hooks.childContext?.(args())).toEqual({ n: 1 })
    expect(sub.output?.kind).toBe('standard')
    expect(await sub.hooks.childOutput?.(args({ output: 5 }))).toBe(5)
    await expect(async () => sub.hooks.childOutput?.(args({ output: 'x' }))).rejects.toThrow(
      /output of 'sub' rejected/,
    )
    // The mapper is compiled raw: a value the child boundary would reject comes back unchanged
    // here — the executor (context) / child bridge (deps) parse it exactly once.
    const bb = defineFlow({ name: 'bad-ctx', context: boundary.trusted() })
    const raw = compile(
      bb.steps({
        f: bb.flow(childFlow, {
          context: () => ({ n: 'no' as Any }),
          deps: () => ({ svc: 1 }) as never,
          next: 'e',
        }),
        e: bb.final(),
      }),
    )
    expect(await raw.steps.f?.hooks.childContext?.(args())).toEqual({ n: 'no' })
    expect(await raw.steps.f?.hooks.childDeps?.(args())).toEqual({ svc: 1 })
    expect((def.steps.sub2 as CompiledStep).hooks.childOutput).toBeUndefined()
    expect((def.steps.sub2 as CompiledStep).hooks.childDeps).toBeUndefined()
  })
})

describe('compile: retry policy validation (one shape shared with the machine, no mapping)', () => {
  const s = defineFlow({ name: 'r', context: boundary.trusted() })
  const retryOf = (retry: Any) =>
    compile(s.steps({ t: s.task(async () => 1, { retry }) })).steps.t?.retry
  it('passes a valid policy through untouched: immediate, fixed ms, exponential (+ tuning)', () => {
    expect(retryOf({ attempts: 2 })).toEqual({ attempts: 2 })
    expect(retryOf({ attempts: 2, backoff: 0 })).toEqual({ attempts: 2, backoff: 0 })
    expect(retryOf({ attempts: 2, backoff: 2000 })).toEqual({ attempts: 2, backoff: 2000 })
    // Defaults (200 ms / 2 / 30 s) are the machine's business — nothing is filled in here.
    expect(retryOf({ attempts: 2, backoff: 'exponential' })).toEqual({
      attempts: 2,
      backoff: 'exponential',
    })
    expect(
      retryOf({ attempts: 2, backoff: 'exponential', baseMs: 50, factor: 3, maxBackoffMs: 900 }),
    ).toEqual({ attempts: 2, backoff: 'exponential', baseMs: 50, factor: 3, maxBackoffMs: 900 })
  })
  it('keeps only the recognised fields', () => {
    expect(retryOf({ attempts: 1, backoff: 10, extra: true })).toEqual({ attempts: 1, backoff: 10 })
  })
  it('rejects malformed policies', () => {
    expect(issuesOf(() => retryOf({ attempts: -1 }))).toEqual([
      "step 't': retry.attempts must be a non-negative integer",
    ])
    expect(issuesOf(() => retryOf({ attempts: 1, backoff: 'linear' }))).toEqual([
      "step 't': retry.backoff must be a number of ms >= 0 or 'exponential'",
    ])
    expect(issuesOf(() => retryOf({ attempts: 1, backoff: -5 }))).toEqual([
      "step 't': retry.backoff must be a number of ms >= 0 or 'exponential'",
    ])
    expect(issuesOf(() => retryOf({ attempts: 1, factor: 2 }))).toEqual([
      "step 't': retry.factor only applies to backoff: 'exponential'",
    ])
    expect(issuesOf(() => retryOf({ attempts: 1, backoff: 100, maxBackoffMs: 5 }))).toEqual([
      "step 't': retry.maxBackoffMs only applies to backoff: 'exponential'",
    ])
    expect(issuesOf(() => retryOf({ attempts: 1, backoff: 'exponential', factor: 0.5 }))).toEqual([
      "step 't': retry.factor must be a number >= 1",
    ])
    expect(issuesOf(() => retryOf({ attempts: 1, backoff: 'exponential', baseMs: -1 }))).toEqual([
      "step 't': retry.baseMs must be a number >= 0",
    ])
    expect(issuesOf(() => retryOf('nope'))).toEqual([
      "step 't': retry must be { attempts, backoff?, baseMs?, factor?, maxBackoffMs? }",
    ])
  })
})

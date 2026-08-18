import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { compile, type FlowWarning } from '../../src/authoring/compile'
import type { CompiledStep, HookArgs } from '../../src/authoring/compiled'
import { defineFlow } from '../../src/authoring/define-flow'
import type { AnyFlow } from '../../src/authoring/types'
import { WizardError } from '../../src/errors'

type Any = any

/** Hand-build a Flow object (JS-caller shape) around raw step records. */
function rawFlow(
  steps: Record<string, Partial<CompiledStepLike>>,
  extra: Record<string, unknown> = {},
): AnyFlow {
  return {
    '~types': undefined,
    name: 'raw',
    context: boundary.trusted(),
    steps: Object.fromEntries(
      Object.entries(steps).map(([id, s]) => [
        id,
        { '~types': undefined, '~bound': undefined, ...s },
      ]),
    ),
    ...extra,
  } as unknown as AnyFlow
}
type CompiledStepLike = Record<string, unknown> & { kind: string }

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

  it('wait: on handlers normalised to { next? }, waitTimeout in ms', async () => {
    const wait = def.steps.wait as CompiledStep
    expect(wait.kind).toBe('wait')
    expect(wait.waitTimeout).toEqual({ afterMs: 900_000, next: 'sub' })
    expect(Object.keys(wait.hooks.on ?? {})).toEqual(['ping'])
    const on = wait.hooks.on?.ping
    expect(await on?.(args({ event: 'ping', payload: { n: 1 } }))).toEqual({ next: 'route' })
    expect(await on?.(args({ event: 'ping', payload: { n: 0 } }))).toBeUndefined()
    const wb = defineFlow({
      name: 'w2',
      context: boundary.trusted(),
      events: { e: boundary.trusted() },
    })
    const w2 = compile(
      wb.steps({
        w: wb.wait({
          on: { e: (() => Promise.resolve({ next: null })) as Any } as Any,
          next: 'end',
        }),
        end: wb.final(),
      }),
    )
    expect(await w2.steps.w?.hooks.on?.e?.(args())).toBeUndefined()
    const wb3 = defineFlow({
      name: 'w3',
      context: boundary.trusted(),
      events: { e: boundary.trusted() },
    })
    const w3 = compile(
      wb3.steps({
        w: wb3.wait({ on: { e: (() => ({ next: 'nope' })) as Any } as Any, next: 'end' }),
        end: wb3.final(),
      }),
    )
    expect(() => w3.steps.w?.hooks.on?.e?.(args())).toThrow(/unknown next target 'nope'/)
  })

  it('decision: dynamic next hook returning fan-out', async () => {
    const route = def.steps.route as CompiledStep
    expect(route.next).toEqual({ kind: 'dynamic' })
    expect(await route.hooks.next?.(args())).toEqual(['sub', 'sub2'])
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

  it('final: finalOutput hook, next none', async () => {
    const done = def.steps.done as CompiledStep
    expect(done.next).toEqual({ kind: 'none' })
    expect(await done.hooks.finalOutput?.(args({ context: { a: 'ctx' } }))).toBe('ctx')
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

describe('compile: validation errors (all problems listed at once)', () => {
  it('unknown ids in next/dependsOn/timeout.next/start, final with next, wait without handlers/timeout, input on non-view', () => {
    const problems = issuesOf(() =>
      compile(
        rawFlow(
          {
            a: { kind: 'view', next: ['b', 'nope'] },
            b: {
              kind: 'task',
              run: () => 1,
              dependsOn: ['ghost'],
              input: boundary.trusted(),
              next: 'w',
            },
            w: { kind: 'wait', on: {}, timeout: { after: '1m', next: 'missing' } },
            w2: { kind: 'wait', on: {} },
            end: { kind: 'final', next: 'a' },
          },
          { start: 'zzz', events: {} },
        ),
      ),
    )
    expect(problems).toEqual([
      "step 'a': next: unknown step 'nope'",
      "step 'b': dependsOn: unknown step 'ghost'",
      "step 'b': only view steps accept 'input' (kind 'task')",
      "step 'w': timeout.next: unknown step 'missing'",
      "step 'w2': a wait with no handlers and no timeout can never complete",
      "step 'end': a final step cannot have next",
      "start: unknown step 'zzz'",
    ])
  })

  it('handlers for undeclared events, malformed hooks, missing run/next/context/child, bad policies', () => {
    const problems = issuesOf(() =>
      compile(
        rawFlow(
          {
            t: { kind: 'task', enter: 42, next: 'd' },
            d: { kind: 'decision' },
            w: { kind: 'wait', on: { ghost: () => {}, bad: 'x' }, next: 'f' },
            f: { kind: 'flow', next: 'x' },
            x: { kind: 'nope' },
            y: { kind: 'final', label: 3 },
          },
          {
            events: { bad: boundary.trusted() },
            onFailure: 'explode',
            autoRun: 'never',
            concurrency: 0,
            unmatchedEvents: { buffer: 'yes' },
            retry: { attempts: 'x' },
          },
        ),
      ),
    )
    expect(problems).toEqual([
      "step 't': 'enter' must be a function",
      "step 't': a task needs a 'run' function",
      "step 'd': a decision needs a 'next' function",
      "step 'w': on['ghost']: the flow declares no event 'ghost'",
      "step 'w': on['bad'] must be a function",
      "step 'f': a flow step needs a child flow (s.flow(child, cfg))",
      "steps['x'] is not a step (build steps with s.view/task/wait/decision/flow/final)",
      "step 'y': 'label' must be a string",
      "onFailure must be 'halt' | 'compensate'",
      "autoRun must be 'ready' | 'manual'",
      'concurrency must be a number >= 1',
      'unmatchedEvents must be { buffer, ttl }',
      'retry.attempts must be a non-negative integer',
    ])
  })

  it('dependency cycles (each reported once), self-dependency, bad durations, empty flow, missing name/context', () => {
    const problems = issuesOf(() =>
      compile(
        rawFlow({
          a: { kind: 'task', run: () => 1, dependsOn: ['b'], next: 'b' },
          b: { kind: 'task', run: () => 1, dependsOn: ['c'], next: 'c' },
          c: { kind: 'task', run: () => 1, dependsOn: ['a'], timeout: '3 weeks', next: 'me' },
          me: { kind: 'task', run: () => 1, dependsOn: ['me'] },
        }),
      ),
    )
    expect(problems).toEqual([
      "step 'c': timeout: invalid duration: '3 weeks' (expected e.g. '250ms', '15s', '15m', '2h', '1d')",
      'dependency cycle: a -> b -> c -> a',
      'dependency cycle: me -> me',
    ])
    expect(issuesOf(() => compile(rawFlow({})))).toEqual(['flow has no steps'])
    expect(
      issuesOf(() =>
        compile({
          steps: { a: { kind: 'final', '~types': undefined } },
          context: 'nope',
        } as unknown as AnyFlow),
      ),
    ).toEqual(["'name' must be a non-empty string", "'context' must be a boundary"])
  })

  it('throws WizardError DEFINITION_INVALID with a message listing every problem', () => {
    try {
      compile(rawFlow({ a: { kind: 'view', next: 'x' }, b: { kind: 'final', next: 'a' } }))
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(WizardError)
      const e = error as WizardError
      expect(e.code).toBe('DEFINITION_INVALID')
      expect(e.message).toContain("flow 'raw' is invalid:")
      expect(e.message).toContain("- step 'a': next: unknown step 'x'")
      expect(e.message).toContain("- step 'b': a final step cannot have next")
    }
  })

  it('per-kind allow-lists: a field another kind owns is a problem naming the kinds that accept it', () => {
    const problems = issuesOf(() =>
      compile(
        rawFlow(
          {
            // `on: {}` is accepted on a view since v0.2 (any kind may listen)
            v: { kind: 'view', run: () => 1, retry: { attempts: 1 }, on: {}, next: 't' },
            t: {
              kind: 'task',
              run: () => 1,
              input: boundary.trusted(),
              canExit: () => true,
              next: 'w',
            },
            w: { kind: 'wait', on: { e: () => {} }, compensate: () => {}, child: {}, next: 'd' },
            d: {
              kind: 'decision',
              next: () => 'f',
              enter: () => {},
              timeout: 5,
              idempotent: true,
              mapError: () => 1,
            },
            f: { kind: 'flow', child: undefined, context: () => ({}), initial: {}, next: 'end' },
            end: { kind: 'final', validate: () => {}, exit: () => {}, when: () => true },
          },
          { events: { e: boundary.trusted() } },
        ),
      ),
    )
    expect(problems).toEqual([
      "step 'v': only task steps accept 'run' (kind 'view')",
      "step 'v': only task steps accept 'retry' (kind 'view')",
      "step 't': only view steps accept 'input' (kind 'task')",
      "step 't': only view steps accept 'canExit' (kind 'task')",
      "step 'w': only task steps accept 'compensate' (kind 'wait')",
      "step 'w': only flow steps accept 'child' (kind 'wait')",
      "step 'd': only view/task/wait steps accept 'enter' (kind 'decision')",
      "step 'd': only task/wait steps accept 'timeout' (kind 'decision')",
      "step 'd': only task steps accept 'idempotent' (kind 'decision')",
      "step 'd': only task steps accept 'mapError' (kind 'decision')",
      "step 'f': only view steps accept 'initial' (kind 'flow')",
      "step 'f': a flow step needs a child flow (s.flow(child, cfg))",
      "step 'end': only view steps accept 'validate' (kind 'final')",
      "step 'end': only view/task/wait/flow steps accept 'exit' (kind 'final')",
      "step 'end': only view/task/wait/decision/flow steps accept 'when' (kind 'final')",
    ])
  })

  it("a flow step's 'deps' mapper is accepted (compiled raw as hooks.childDeps)", () => {
    const c = defineFlow({
      name: 'child',
      context: boundary.trusted<{ n: number }>(),
      deps: boundary.trusted<{ svc: number }>(),
    })
    const child = c.steps({ end: c.final() })
    const s = defineFlow({ name: 'p', context: boundary.trusted<{ n: number }>() })
    const flow = s.steps({
      f: s.flow(child, { context: () => ({ n: 1 }), deps: () => ({ svc: 1 }), next: 'e' }),
      e: s.final(),
    })
    expect(compile(flow).steps.f?.hooks.childDeps?.(args())).toEqual({ svc: 1 })
  })
})

describe('compile: warnings (advisory, reused by inspect)', () => {
  const s = defineFlow({ name: 'warn', context: boundary.trusted() })
  const collect = (flow: AnyFlow): FlowWarning[] => {
    const out: FlowWarning[] = []
    compile(flow, { onWarning: (w) => out.push(w) })
    return out
  }

  it('unreachable steps and dependsOn without incoming edges', () => {
    const flow = s.steps(
      {
        a: s.view({ next: 'b' }),
        b: s.final(),
        orphan: s.view({ next: 'b' }),
        gated: s.task(async () => 1, { dependsOn: ['a'], next: 'b' }),
      },
      { start: 'a' },
    )
    expect(collect(flow)).toEqual([
      {
        code: 'UNREACHABLE',
        message: "step 'orphan' is not reachable from start",
        step: 'orphan',
        path: [],
      },
      {
        code: 'NEVER_ACTIVATES',
        message:
          "step 'gated' declares dependsOn but has no incoming next/start edge, so it can never activate",
        step: 'gated',
        path: [],
      },
    ])
  })

  it('timeout targets and fan-out count as edges; a reachable dynamic next silences the analysis', () => {
    const se = defineFlow({
      name: 'edges',
      context: boundary.trusted(),
      events: { e: boundary.trusted() },
    })
    const flow = se.steps({
      w: se.wait({ on: { e: () => {} }, timeout: { after: '1m', next: 'late' }, next: ['a', 'b'] }),
      a: se.final(),
      b: se.final(),
      late: se.final(),
    })
    expect(collect(flow)).toEqual([])
    const dyn = s.steps({
      d: s.decision({ next: () => 'far' }),
      far: s.final(),
      farther: s.final(),
    })
    expect(collect(dyn)).toEqual([])
    const dynUnreached = s.steps({
      a: s.view({ next: 'b' }),
      b: s.final(),
      d: s.decision({ next: () => 'a' }),
    })
    expect(collect(dynUnreached).map((w) => w.step)).toEqual(['d'])
  })

  it('navigation cycles through next / timeout.next are advisory NAV_CYCLE warnings (each cycle once)', () => {
    const se = defineFlow({
      name: 'loops',
      context: boundary.trusted(),
      events: { e: boundary.trusted() },
    })
    const flow = se.steps({
      a: se.view({ next: 'b' }),
      b: se.view({ next: ['a', 'w'] }), // a → b → a
      w: se.wait({ on: { e: () => {} }, timeout: { after: '1m', next: 'w' }, next: 'end' }), // w → w (timeout)
      end: se.final(),
    })
    expect(collect(flow)).toEqual([
      {
        code: 'NAV_CYCLE',
        message:
          'navigation cycle: a -> b -> a (allowed; make sure a guard, a decision or a wait breaks it)',
        step: 'a',
        path: [],
      },
      {
        code: 'NAV_CYCLE',
        message:
          'navigation cycle: w -> w (allowed; make sure a guard, a decision or a wait breaks it)',
        step: 'w',
        path: [],
      },
    ])
    // Cycles are allowed: the flow compiles and a plain chain has no warning.
    expect(collect(s.steps({ a: s.view({ next: 'b' }), b: s.final() }))).toEqual([])
  })

  it('nested flows report warnings with their path; onWarning is replayed from the cache', () => {
    const c = defineFlow({ name: 'child', context: boundary.trusted() })
    const child = c.steps({ a: c.final(), lost: c.final() })
    const flow = s.steps({ f: s.flow(child, { context: () => ({}), next: 'e' }), e: s.final() })
    const first = collect(flow)
    expect(first).toEqual([
      {
        code: 'UNREACHABLE',
        message: "step 'lost' is not reachable from start",
        step: 'lost',
        path: ['f'],
      },
    ])
    expect(collect(flow)).toEqual(first)
  })
})

describe('compile: nesting', () => {
  it('rejects a flow embedding one of its ancestors (NESTING_CYCLE)', () => {
    // A cycle can only be built by mutation after definition (s.flow needs the child object).
    const cyclic = rawFlow({
      f: { kind: 'flow', child: undefined, context: () => ({}), next: 'e' },
      e: { kind: 'final' },
    })
    ;(cyclic.steps as unknown as Record<string, Record<string, unknown>>).f!.child = cyclic
    try {
      compile(cyclic)
      expect.unreachable()
    } catch (error) {
      expect((error as WizardError).code).toBe('NESTING_CYCLE')
      expect((error as WizardError).step).toBe('f')
    }
  })

  it('collects every problem of the tree before throwing: the nesting code wins, siblings are still reported', () => {
    const cyclic = rawFlow({
      bad: { kind: 'view', next: 'nope' },
      f: { kind: 'flow', child: undefined, context: () => ({}), next: 'e' },
      g: {
        kind: 'flow',
        child: rawFlow({ x: { kind: 'view', next: 'ghost' } }),
        context: () => ({}),
        next: 'e',
      },
      e: { kind: 'final' },
    })
    ;(cyclic.steps as unknown as Record<string, Record<string, unknown>>).f!.child = cyclic
    try {
      compile(cyclic)
      expect.unreachable()
    } catch (error) {
      const e = error as WizardError
      expect(e.code).toBe('NESTING_CYCLE')
      expect(e.step).toBe('f')
      expect(e.issues?.map((i) => i.message)).toEqual([
        "step 'bad': next: unknown step 'nope'",
        "flow 'raw' embeds one of its ancestors (at step 'f')",
        "g: step 'x': next: unknown step 'ghost'",
      ])
    }
  })

  it('allows 8 nested levels and rejects the 9th (NESTING_TOO_DEEP)', () => {
    const leaf = defineFlow({ name: 'leaf', context: boundary.trusted() })
    let current: AnyFlow = leaf.steps({ e: leaf.final() })
    for (let level = 1; level <= 8; level += 1) {
      const s = defineFlow({ name: `level${level}`, context: boundary.trusted() })
      current = s.steps({ c: s.flow(current, { context: () => ({}), next: 'e' }), e: s.final() })
    }
    const nine = defineFlow({ name: 'nine', context: boundary.trusted() })
    try {
      nine.steps({ c: nine.flow(current, { context: () => ({}), next: 'e' }), e: nine.final() })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(WizardError)
      expect((error as WizardError).code).toBe('NESTING_TOO_DEEP')
      expect((error as WizardError).message).toContain('c/c/c/c/c/c/c/c/c')
    }
  })
})

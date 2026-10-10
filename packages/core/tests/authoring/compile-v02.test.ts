/**
 * `compile()` — v0.2 DSL fields (plan §9): `on` on every kind (per-kind result normalisation),
 * flow-level `on` / `correlate`, `when`, `idempotent`, `mapError`, and the definition problems
 * they add.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { compile } from '../../src/authoring/compile'
import type { HookArgs } from '../../src/authoring/compiled'
import { defineFlow } from '../../src/authoring/define-flow'
import { WizardError } from '../../src/errors'

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

const s = defineFlow({
  name: 'v02',
  context: z.object({ id: z.string(), note: z.string().optional() }),
  events: {
    'note.added': z.object({ text: z.string() }),
    'order.cancelled': z.object({ orderId: z.string(), reason: z.string() }),
  },
  on: {
    'note.added': ({ update, payload }) => update({ note: payload.text }),
    'order.cancelled': ({ payload }) => ({ cancel: payload.reason }),
  },
  correlate: { 'order.cancelled': (p) => p.orderId },
})

const issuesOf = (fn: () => unknown): string[] => {
  try {
    fn()
  } catch (error) {
    if (error instanceof WizardError) return (error.issues ?? []).map((i) => i.message)
    throw error
  }
  throw new Error('expected a WizardError')
}

describe('compile v0.2: `on` on every kind', () => {
  const flow = s.steps(
    {
      review: s.view({
        on: {
          'note.added': ({ payload }) => (payload.text === 'go' ? { next: 'post' } : undefined),
        },
        next: 'post',
      }),
      post: s.task(async () => 1, { on: { 'note.added': () => {} }, next: 'route' }),
      route: s.decision({ on: { 'note.added': () => undefined }, next: () => 'hold' }),
      hold: s.wait({
        on: {
          'note.added': ({ payload }) =>
            payload.text === 'wait'
              ? { keep: true }
              : { next: payload.text === 'x' ? null : 'done' },
        },
        next: 'done',
      }),
      done: s.final({ on: { 'note.added': () => {} } }),
    },
    { start: 'review' },
  )
  const def = compile(flow)
  it('handler results reach the machine RAW for every kind (the machine applies the per-kind contract)', async () => {
    const view = def.steps.review?.hooks.on?.['note.added']
    expect(await view?.(args({ payload: { text: 'go' } }))).toEqual({ next: 'post' })
    expect(await view?.(args({ payload: { text: 'stay' } }))).toBeUndefined()
    const hold = def.steps.hold?.hooks.on?.['note.added']
    expect(await hold?.(args({ payload: { text: 'wait' } }))).toEqual({ keep: true })
    expect(await hold?.(args({ payload: { text: 'x' } }))).toEqual({ next: null })
    // Untyped (JS-style) handlers returning what their kind cannot honour are NOT wrapped: the
    // machine ignores / fails them at delivery (`event.handlerResultIgnored`, `UNKNOWN_STEP`).
    const raw = defineFlow({
      name: 'raw',
      context: boundary.trusted<{}>(),
      events: { e: boundary.trusted<unknown>() },
    })
    const bad = raw.steps({
      t: raw.task(async () => 1, {
        on: { e: (() => ({ next: 'end' })) as unknown as () => undefined },
        next: 'end',
      }),
      w: raw.wait({
        on: { e: (() => ({ next: 'typo' })) as unknown as () => undefined },
        next: 'end',
      }),
      end: raw.final(),
    })
    const d = compile(bad)
    expect(await d.steps.t?.hooks.on?.e?.(args())).toEqual({ next: 'end' })
    expect(await d.steps.w?.hooks.on?.e?.(args())).toEqual({ next: 'typo' })
  })
  it('a wait still needs `on`; other kinds do not; undeclared events are problems everywhere', () => {
    const raw = defineFlow({
      name: 'raw',
      context: boundary.trusted<{}>(),
      events: { e: boundary.trusted<unknown>() },
    })
    expect(
      issuesOf(() =>
        raw.steps({
          v: raw.view({ on: { nope: () => {} } as never, next: 'end' }),
          t: raw.task(async () => 1, { on: { nope: () => {} } as never, next: 'end' }),
          end: raw.final(),
        }),
      ),
    ).toEqual([
      "step 'v': on['nope']: the flow declares no event 'nope'",
      "step 't': on['nope']: the flow declares no event 'nope'",
    ])
    expect(issuesOf(() => raw.steps({ w: raw.wait({} as never), end: raw.final() }))).toEqual([
      "step 'w': a wait needs an 'on' object of event handlers",
      "step 'w': a wait with no handlers and no timeout can never complete",
    ])
    expect(issuesOf(() => raw.steps({ t: raw.task(async () => 1, { on: 5 } as never) }))).toEqual([
      "step 't': 'on' must be an object of event handlers",
    ])
  })
})

describe('compile v0.2: flow-level `on` and `correlate`', () => {
  const flow = s.steps({ a: s.view({ next: 'end' }), end: s.final() })
  const def = compile(flow)

  it('emits `def.on` with results normalised to `{ cancel }` / undefined', async () => {
    expect(Object.keys(def.on ?? {})).toEqual(['note.added', 'order.cancelled'])
    const patches: unknown[] = []
    const update = (p: unknown): void => {
      patches.push(p)
    }
    expect(
      await def.on?.['note.added']?.(args({ payload: { text: 'hi' }, update })),
    ).toBeUndefined()
    expect(patches).toEqual([{ note: 'hi' }])
    expect(
      await def.on?.['order.cancelled']?.(
        args({ payload: { orderId: 'o', reason: 'changed mind' } }),
      ),
    ).toEqual({ cancel: 'changed mind' })
  })
  it('a flow-level handler returning anything but void / { cancel } is a TypeError', async () => {
    const raw = defineFlow({
      name: 'raw',
      context: boundary.trusted<{}>(),
      events: { e: boundary.trusted<unknown>() },
      on: { e: (() => ({ next: 'a' })) as unknown as () => undefined },
    })
    const d = compile(raw.steps({ a: raw.final() }))
    await expect(async () => d.on?.e?.(args())).rejects.toThrow(
      'a flow-level on handler must return void or { cancel: reason }',
    )
  })
  it('emits `def.correlate`; a non-string result is `undefined`', () => {
    expect(Object.keys(def.correlate ?? {})).toEqual(['order.cancelled'])
    expect(def.correlate?.['order.cancelled']?.({ orderId: 'o-1', reason: 'r' })).toBe('o-1')
    expect(def.correlate?.['order.cancelled']?.({ orderId: 42, reason: 'r' })).toBeUndefined()
    expect(def.correlate?.['note.added']).toBeUndefined()
  })
  it('validates event names and shapes of `on` / `correlate` (header and compile)', () => {
    const raw = defineFlow({
      name: 'raw',
      context: boundary.trusted<{}>(),
      events: { e: boundary.trusted<unknown>() },
      on: { nope: () => {}, e: 5 } as never,
      correlate: { other: () => 'x', e: 'no' } as never,
    })
    expect(issuesOf(() => raw.steps({ a: raw.final() }))).toEqual([
      "on['nope']: the flow declares no event 'nope'",
      "on['e'] must be a function",
      "correlate['other']: the flow declares no event 'other'",
      "correlate['e'] must be a function",
    ])
    expect(() =>
      defineFlow({ name: 'x', context: boundary.trusted<{}>(), on: 5 as never }),
    ).toThrow("'on' must be an object of functions keyed by event name")
    expect(() =>
      defineFlow({ name: 'x', context: boundary.trusted<{}>(), correlate: 'x' as never }),
    ).toThrow("'correlate' must be an object of functions keyed by event name")
  })
})

describe('compile v0.2: `when`, `idempotent`, `mapError`', () => {
  it('`when` compiles to hooks.when on every non-final kind', async () => {
    const flow = s.steps({
      v: s.view({ when: () => true, next: 'end' }),
      t: s.task(async () => 1, { when: async () => false, next: 'end' }),
      w: s.wait({ on: { 'note.added': () => {} }, when: () => true, next: 'end' }),
      d: s.decision({ when: () => true, next: () => 'end' }),
      end: s.final(),
    })
    const def = compile(flow)
    for (const id of ['v', 'w', 'd']) expect(await def.steps[id]?.hooks.when?.(args())).toBe(true)
    expect(await def.steps.t?.hooks.when?.(args())).toBe(false)
    expect(def.steps.end?.hooks.when).toBeUndefined()
  })
  it('`idempotent: true` → `idempotent: true` (no key hook); a function → key hook + idempotent', async () => {
    const flow = s.steps({
      a: s.task(async () => 1, { idempotent: true, next: 'b' }),
      b: s.task(async () => 1, { idempotent: ({ context }) => `post:${context.id}`, next: 'c' }),
      c: s.task(async () => 1, { idempotent: false, next: 'end' }),
      d: s.task(async () => 1, { next: 'end' }),
      end: s.final(),
    })
    const def = compile(flow)
    expect(def.steps.a).toMatchObject({ idempotent: true })
    expect(def.steps.a?.hooks.idempotencyKey).toBeUndefined()
    expect(def.steps.b).toMatchObject({ idempotent: true })
    expect(await def.steps.b?.hooks.idempotencyKey?.(args({ context: { id: 'o-1' } }))).toBe(
      'post:o-1',
    )
    expect(def.steps.c?.idempotent).toBeUndefined()
    expect(def.steps.d?.idempotent).toBeUndefined()
    // A key function must return a non-empty string.
    const raw = defineFlow({ name: 'raw', context: boundary.trusted<{}>() })
    const d = compile(
      raw.steps({
        t: raw.task(async () => 1, { idempotent: (() => 42) as unknown as () => string }),
      }),
    )
    await expect(async () => d.steps.t?.hooks.idempotencyKey?.(args())).rejects.toThrow(
      'an idempotency key function must return a non-empty string',
    )
    expect(
      issuesOf(() => raw.steps({ t: raw.task(async () => 1, { idempotent: 'yes' } as never) })),
    ).toEqual(["step 't': 'idempotent' must be true, false or a function returning the key"])
  })
  it('`mapError` compiles to hooks.mapError called with (args.error, args)', async () => {
    const seen: unknown[] = []
    const flow = s.steps({
      t: s.task(async () => 1, {
        mapError: (error, a) => {
          seen.push(error, a.attempt)
          return { code: 'DOWN' }
        },
        next: 'end',
      }),
      end: s.final(),
    })
    const def = compile(flow)
    const boom = new Error('boom')
    expect(await def.steps.t?.hooks.mapError?.(args({ error: boom, attempt: 3 }))).toEqual({
      code: 'DOWN',
    })
    expect(seen).toEqual([boom, 3])
    expect(def.steps.end?.hooks.mapError).toBeUndefined()
    const raw = defineFlow({ name: 'raw', context: boundary.trusted<{}>() })
    expect(
      issuesOf(() => raw.steps({ t: raw.task(async () => 1, { mapError: 5 } as never) })),
    ).toEqual(["step 't': 'mapError' must be a function"])
  })
})

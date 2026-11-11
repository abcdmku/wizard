// Wave B additions to scenarios.ts (paste after section 11; merge the imports).
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import type { RunAdapter } from '../../src/authoring/run-adapter'
import type {
  AnyStep,
  AnyWizard,
  ErrorOf,
  FlowOutput,
  JsonValue,
  OutputOf,
  RequiredDepsOf,
  RunArgs,
  StepApi,
} from '../../src/authoring/types'
import { defineWizard } from '../../src/wizard/define-wizard'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
declare function assert<T extends true>(): void

// 12. Sink outputs: precise without branches, never a lie with them
export const fanOut = defineWizard(
  { name: 'fan-out', context: z.object({}) },
  ({ step, steps }) => {
    const shopA = step({ run: () => ({ price: 1 }) })
    const shopB = step({ run: () => ({ price: 2 }) })
    const best = step({
      needs: { shopA, shopB },
      run: ({ needs }) => Math.min(needs.shopA.price, needs.shopB.price),
    })
    return steps({ shopA, shopB, best }, { start: ['shopA', 'shopB'] })
  },
)
assert<Equal<FlowOutput<typeof fanOut>, number>>() // same-shape producers pulled by shorthand needs
export const twins = defineWizard({ name: 'twins', context: z.object({}) }, ({ step, steps }) => {
  const a = step({ run: () => 1 })
  const b = step({ run: () => 1 })
  const join = step({ needs: { first: a }, run: () => 'j' })
  return steps({ a, b, join }, { start: ['a', 'b'] })
})
assert<Equal<number extends FlowOutput<typeof twins> ? true : false, true>>() // b is a real sink
export const guarded = defineWizard(
  { name: 'guarded', context: z.object({ ok: z.boolean() }) },
  ({ step, steps }) => steps({ only: step({ when: ({ context }) => context.ok, run: () => 1 }) }),
)
assert<Equal<FlowOutput<typeof guarded>, number | undefined>>()
export const exclusiveJoin = defineWizard(
  { name: 'exclusive', context: z.object({ ok: z.boolean() }) },
  ({ step, steps }) => {
    const card = step({ run: () => 1 })
    const invoice = step({ run: () => 2 })
    const choose = step({
      targets: [card, invoice],
      next: ({ context }) => (context.ok ? card : invoice),
    })
    const join = step({ needs: { card, invoice }, run: () => 'both' as const })
    return steps({ choose, card, invoice, join })
  },
)
assert<Equal<FlowOutput<typeof exclusiveJoin>, 'both' | undefined>>() // join is skipped at runtime
const maybeChild = defineWizard(
  { name: 'maybe-child', context: z.object({ ok: z.boolean() }) },
  ({ step, steps }) =>
    steps({ s: step({ when: ({ context }) => context.ok, run: () => 'x' as const }) }),
)
export const usesMaybeChild = defineWizard(
  { name: 'uses-maybe', context: z.object({}) },
  ({ flow, steps }) => steps({ c: flow(maybeChild, { context: () => ({ ok: true }) }) }),
)
assert<Equal<OutputOf<typeof usesMaybeChild, 'c'>, 'x' | undefined>>()
export const collision = defineWizard(
  { name: 'collision', context: z.object({}) },
  ({ step, steps }) => steps({ a: step({ run: () => ({ '~unset': true as const }) }) }),
)
assert<Equal<OutputOf<typeof collision, 'a'>, { '~unset': true }>>() // no sentinel collision

// 13. One mistake, one error, on its line (map steps, nested options, needs)
export const oneError = defineWizard(
  { name: 'one-error', context: z.object({ n: z.number(), ids: z.array(z.string()) }) },
  ({ step, steps }) => {
    const load = step({ run: ({ context }) => context.n })
    return steps({
      load,
      fetch: step({
        each: ({ context }) => context.ids,
        run: ({ item, needs }) => item.length + needs.load,
        needs: { load },
        // @ts-expect-error ; misspelled option (did-you-mean), and `item` stays typed
        concurency: 4,
      }),
      timed: step({
        each: ({ context }) => context.ids,
        run: ({ item }) => item,
        // @ts-expect-error ; not a Duration
        timeout: '5 seconds',
      }),
      join: step({
        needs: { load },
        run: ({ context, needs }) => context.n + needs.load,
        // @ts-expect-error ; attempts is a number (no `Unset` error on the run line)
        retry: { attempts: '3' },
      }),
      // @ts-expect-error ; a need is a step object, not an id
      bad: step({ needs: { load: 'load' }, run: ({ needs }) => needs.load }),
      // @ts-expect-error ; `{ any }` needs at least one step
      none: step({ needs: { v: { any: [] } }, run: () => 0 }),
      // @ts-expect-error ; `waitFor` needs at least one handler
      idle: step({ waitFor: {} }),
    })
  },
)

// 14. Refs: two spellings of one step are fine; membership is checked on assembly
export const spellings = defineWizard(
  { name: 'spellings', context: z.object({ ok: z.boolean() }) },
  ({ step, steps }) => {
    const a = step({ run: () => 1 })
    const b = step({ run: () => 'b' })
    const c = step({ run: () => true }) // distinct outputs: identical twins are only told apart at runtime
    return steps({
      a,
      b,
      c,
      byObject: step({ targets: [a, 'b'], next: ({ context }) => (context.ok ? 'a' : b) }),
      // @ts-expect-error ; next may return a step object that is not in targets
      escapes: step({ targets: [a, b], next: ({ context }) => (context.ok ? a : c) }),
      // @ts-expect-error ; next may return 'c', which is not in targets
      escapesById: step({ targets: [a, 'b'], next: ({ context }) => (context.ok ? b : 'c') }),
    })
  },
)
const orphan = defineWizard({ name: 'o', context: z.object({}) }, ({ step, steps }) =>
  steps({ x: step({ run: () => 0 }) }),
)
declare const someId: string
export const badRefs = defineWizard(
  { name: 'bad-refs', context: z.object({ ok: z.boolean() }) },
  ({ step, steps }) => {
    const lost = step({ run: () => 'lost' as const })
    return steps({
      // @ts-expect-error ; `lost` is not a step of this map
      a: step({ run: () => 1, next: lost }),
      // @ts-expect-error ; an id typed as plain string is unchecked
      b: step({ run: () => 1, next: someId }),
      v: step({ run: () => 1 }),
    })
  },
)
void orphan

// 15. Generic step modules compile (they are how large wizards split across files)
function hop<C, Ev, D, N extends string>({ step }: StepApi<C, Ev, D>, to: N) {
  return { hop: step({ run: () => 0, next: to }) }
}
function totalOf<C, Ev, D, L extends AnyStep>({ step }: StepApi<C, Ev, D>, load: L) {
  return { total: step({ needs: { load }, run: () => 0 }) }
}
export const modular = defineWizard({ name: 'modular', context: z.object({}) }, (api) => {
  const load = api.step({ run: () => 1 })
  return api.steps({ load, ...hop(api, 'load'), ...totalOf(api, load) }, { start: 'hop' })
})

// 16. Waits, views and handlers route only through checked refs
export const handlers = defineWizard(
  { name: 'handlers', context: z.object({}), events: { ok: z.object({ by: z.string() }) } },
  ({ step, view, steps }) =>
    steps({
      wait: step({
        // @ts-expect-error ; a wait result does not route; put `next` on the step
        waitFor: { ok: ({ payload }) => ({ done: payload.by, next: 'end' }) },
      }),
      // @ts-expect-error ; unknown step id returned by an `on` handler
      form: view({ input: z.object({ a: z.string() }), on: { ok: () => ({ next: 'zzz' }) } }),
      end: step({ run: () => 0 }),
    }),
)

// 17. Deps: provide() and child flows
type Mail = { send(to: string): Promise<void> }
type NotifyDeps = { mail: Mail; log: (m: string) => void }
const notify2 = defineWizard(
  { name: 'notify2', context: z.object({ to: z.string() }), deps: boundary.trusted<NotifyDeps>() },
  ({ step, steps }) =>
    steps({ send: step({ run: ({ context, deps }) => deps.mail.send(context.to) }) }),
)
declare const partialDeps: Partial<NotifyDeps>
const partly = notify2.provide(partialDeps)
assert<Equal<RequiredDepsOf<typeof partly>, NotifyDeps>>() // a maybe-missing key is not provided
// @ts-expect-error ; 'extra' is not a dependency of this wizard
notify2.provide({ log: () => {}, extra: 1 })
const leaf = defineWizard(
  { name: 'leaf', context: z.object({ to: z.string() }) },
  ({ step, steps }) => steps({ s: step({ run: ({ context }) => context.to }) }),
)
export const plainParent = defineWizard(
  { name: 'plain-parent', context: z.object({ to: z.string() }) },
  ({ flow, steps }) => steps({ c: flow(leaf, { context: ({ context }) => ({ to: context.to }) }) }),
)
export const perItemDeps = defineWizard(
  { name: 'per-item-deps', context: z.object({ to: z.array(z.string()) }) },
  ({ flow, steps }) =>
    steps({
      all: flow(notify2, {
        each: ({ context }) => context.to,
        context: ({ item }) => ({ to: item }),
        deps: ({ item }) => ({ mail: { send: async () => {} }, log: () => void item }),
      }),
    }),
)
declare function host<F extends AnyWizard>(wizard: F): F
host(plainParent)
host(partly)

// 18. Errors: typed through mapError and run adapters, JSON when persisted
declare function adapter<C, D, A, E extends JsonValue>(
  program: (args: RunArgs<C, D>) => Promise<A>,
  options: { mapError: (e: unknown) => E },
): RunAdapter<C, D, A, E>
export const typedErrors = defineWizard(
  { name: 'typed-errors', context: z.object({ id: z.string() }) },
  ({ step, steps }) =>
    steps({
      viaAdapter: step({
        run: adapter(async ({ context }) => context.id, {
          mapError: () => ({ code: 'DOWN' as const }),
        }),
        retry: { attempts: 2, when: (e) => e.code === 'DOWN' },
      }),
      // @ts-expect-error ; a mapped error is persisted, so it must be JSON
      notJson: step({ run: () => 1, mapError: () => new Date() }),
    }),
)
assert<Equal<ErrorOf<typeof typedErrors, 'viaAdapter'>, { code: 'DOWN' }>>()

// 19. Empty shapes are mistakes
export const noSteps = defineWizard({ name: 'no-steps', context: z.object({}) }, ({ steps }) =>
  // @ts-expect-error a wizard needs at least one step
  steps({}),
)
export const noStart = defineWizard(
  { name: 'no-start', context: z.object({}) },
  ({ step, steps }) =>
    steps(
      { a: step({ run: () => 1 }) },
      // @ts-expect-error ; `start` lists at least one step
      { start: [] },
    ),
)

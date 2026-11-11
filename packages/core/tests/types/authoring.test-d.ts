/**
 * Executable spec for the round-3 authoring API (tmp/r3/CONTRACTS.md R1–R8).
 * Every prototype implements `./api` (types + `declare` functions only) so that this file typechecks
 * under strict + exactOptionalPropertyTypes + noUncheckedIndexedAccess, and every `@ts-expect-error`
 * line is a real error. Do not weaken a scenario to make it pass ; report it instead.
 */
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import type {
  ContextInput,
  EventType,
  OutputOf,
  RequiredDepsOf,
  StepApi,
  StepId,
} from '../../src/authoring/types'
import type { Run } from '../../src/wizard/create-wizard/wizard'
import { defineWizard } from '../../src/wizard/define-wizard'
import type { RunOutcome } from '../../src/wizard/results'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
declare function expectType<T>(value: T): void
declare function assert<T extends true>(): void

// 1. Linear steps: outputs inferred from `run`, sink output is the wizard output
export const hello = defineWizard(
  { name: 'hello', context: z.object({ name: z.string() }) },
  ({ step, steps }) =>
    steps({
      greet: step({ run: ({ context }) => `Hello, ${context.name}!`, next: 'shout' }),
      shout: step({ run: ({ context }) => context.name.toUpperCase() }),
    }),
)
assert<Equal<StepId<typeof hello>, 'greet' | 'shout'>>()
assert<Equal<OutputOf<typeof hello, 'greet'>, string>>()
assert<Equal<ContextInput<typeof hello>, { name: string }>>()
export async function s1() {
  const outcome = await hello.run({ name: 'Ada' })
  if (outcome.status === 'done') expectType<string>(outcome.output)
  // @ts-expect-error ; input is checked
  await hello.run({ nam: 'Ada' })
}

// 2. Views: typed draft and parsed output; exit sees the parsed output
export const signup = defineWizard(
  { name: 'signup', context: z.object({ email: z.string().default('') }) },
  ({ view, step, steps }) =>
    steps({
      contact: view({
        input: z.object({ email: z.string().email(), age: z.coerce.number().int() }),
        initial: { email: '' },
        exit: ({ output, update }) => {
          expectType<number>(output.age)
          update({ email: output.email })
        },
        next: 'welcome',
      }),
      welcome: step({ run: ({ context }) => context.email }),
    }),
)
export function s2(run: Run<typeof signup>) {
  void run.setInput('contact', { email: 'a@b.c' })
  // @ts-expect-error ; unknown draft key
  void run.setInput('contact', { emial: 'x' })
  // @ts-expect-error ; welcome is not a view
  void run.setInput('welcome', {})
}

// 3. Fan-out + typed join via `needs` (pull: the join activates when its needs are done)
type Services = {
  profiles: { load(id: string): Promise<{ name: string }> }
  orders: { list(id: string): Promise<{ total: number }[]> }
}
export const dashboard = defineWizard(
  {
    name: 'dashboard',
    context: z.object({ userId: z.string() }),
    deps: boundary.trusted<Services>(),
  },
  ({ step, steps }) => {
    const profile = step({ run: ({ context, deps }) => deps.profiles.load(context.userId) })
    const orders = step({ run: ({ context, deps }) => deps.orders.list(context.userId) })
    const summary = step({
      needs: { profile, orders },
      run: ({ needs }) => {
        expectType<{ name: string }>(needs.profile)
        expectType<{ total: number }[]>(needs.orders)
        return { name: needs.profile.name, spent: needs.orders.reduce((s, o) => s + o.total, 0) }
      },
    })
    return steps({ profile, orders, summary }, { start: ['profile', 'orders'] })
  },
)
assert<Equal<OutputOf<typeof dashboard, 'summary'>, { name: string; spent: number }>>()

// 4. Conditional branch with declared targets + `{ any }` join; dynamic next is constrained
export const payment = defineWizard(
  { name: 'payment', context: z.object({ method: z.enum(['card', 'invoice']) }) },
  ({ step, steps }) => {
    const card = step({ run: async () => ({ chargeId: 'ch_1' }) })
    const invoice = step({ run: async () => ({ invoiceId: 'in_1' }) })
    const choose = step({
      targets: [card, invoice],
      next: ({ context }) => (context.method === 'card' ? card : invoice),
    })
    const receipt = step({
      needs: { paid: { any: [card, invoice] } },
      run: ({ needs }) => {
        expectType<{ chargeId: string } | { invoiceId: string }>(needs.paid)
        return 'receipt'
      },
    })
    return steps({ choose, card, invoice, receipt })
  },
)
export const badBranch = defineWizard(
  { name: 'bad-branch', context: z.object({ ok: z.boolean() }) },
  ({ step, steps }) =>
    steps({
      a: step({ run: () => 1 }),
      b: step({ run: () => 2 }),
      // @ts-expect-error ; a dynamic next must declare its targets
      choose: step({ next: ({ context }) => (context.ok ? 'a' : 'b') }),
      pick: step({
        targets: ['a'],
        // @ts-expect-error ; 'b' is not a declared target
        next: ({ context }) => (context.ok ? 'a' : 'b'),
      }),
    }),
)

// 5. Map over N items with concurrency and a stable key; output is an array
export const summarize = defineWizard(
  {
    name: 'summarize',
    context: z.object({ docs: z.array(z.object({ id: z.string(), text: z.string() })) }),
  },
  ({ step, steps }) => {
    const summaries = step({
      each: ({ context }) => context.docs,
      key: (doc) => doc.id,
      concurrency: 8,
      retry: { retries: 3, backoff: 'exponential', jitter: 0.2 },
      run: async ({ item, index, progress }) => {
        progress({ chars: item.text.length })
        return { id: item.id, index, words: item.text.split(' ').length }
      },
    })
    const total = step({
      needs: { summaries },
      run: ({ needs }) => needs.summaries.reduce((n, s) => n + s.words, 0),
    })
    return steps({ summaries, total })
  },
)
assert<
  Equal<OutputOf<typeof summarize, 'summaries'>, { id: string; index: number; words: number }[]>
>()

// 6. Loop until a condition (self edge declared in targets); atomic update(fn)
export const poller = defineWizard(
  { name: 'poller', context: z.object({ jobId: z.string(), attempts: z.number().default(0) }) },
  ({ step, steps }) =>
    steps({
      poll: step({
        run: async ({ update }) => {
          update((current) => ({ attempts: current.attempts + 1 }))
          return { done: Math.random() > 0.5 }
        },
        targets: ['poll', 'finish'],
        next: ({ output }) => (output.done ? 'finish' : 'poll'),
      }),
      finish: step({ run: ({ context }) => context.attempts }),
    }),
)

// 7. Human approval with a deadline; a durable sleep; typed events and send
export const approval = defineWizard(
  {
    name: 'approval',
    context: z.object({ amount: z.number() }),
    events: {
      approved: z.object({ by: z.string() }),
      rejected: z.object({ by: z.string(), reason: z.string() }),
    },
  },
  ({ step, steps }) =>
    steps({
      wait: step({
        waitFor: {
          approved: ({ payload }) => ({ done: { decision: 'approved' as const, by: payload.by } }),
          rejected: ({ payload }) => ({ done: { decision: 'rejected' as const, by: payload.by } }),
        },
        timeout: { after: '48h', next: 'expired' },
        next: 'cooldown',
      }),
      cooldown: step({ sleep: '10m', next: 'apply' }),
      apply: step({ run: ({ context }) => context.amount }),
      expired: step({ run: () => 'expired' as const }),
    }),
)
assert<Equal<EventType<typeof approval>, 'approved' | 'rejected'>>()
assert<
  Equal<
    OutputOf<typeof approval, 'wait'>,
    { decision: 'approved'; by: string } | { decision: 'rejected'; by: string } | undefined
  >
>()
export async function s7(run: Run<typeof approval>) {
  const sent = await run.send('approved', { by: 'lee' }, { eventId: 'evt_1' })
  if (sent.ok && sent.duplicate) expectType<readonly string[]>(sent.delivered)
  // @ts-expect-error ; unknown event
  await run.send('approve', { by: 'lee' })
  // @ts-expect-error ; wrong payload for a known event
  await run.send('approved', { reason: 'x' })
  await run.send('approved', JSON.parse('{}') as unknown) // untrusted bodies still accepted
}

// 8. Saga: compensate receives the typed output and an idempotency key; fallback edge
export const trip = defineWizard(
  { name: 'trip', context: z.object({ city: z.string() }), onFailure: 'compensate' },
  ({ step, steps }) =>
    steps({
      hotel: step({
        run: async ({ idempotencyKey }) => ({ bookingId: idempotencyKey }),
        compensate: ({ output, idempotencyKey }) => {
          expectType<string>(output.bookingId)
          expectType<string>(idempotencyKey)
        },
        next: 'flight',
      }),
      flight: step({
        run: async () => ({ pnr: 'X' }),
        retry: { retries: 3, when: (error) => error instanceof Error },
        fallback: 'manual',
      }),
      manual: step({ run: () => 'queued for an agent' }),
    }),
)

// 9. Child wizard: provided deps travel; remaining deps are required; typed child output
type Mail = { send(to: string): Promise<void> }
const notify = defineWizard(
  {
    name: 'notify',
    context: z.object({ to: z.string() }),
    deps: boundary.trusted<{ mail: Mail; log: (m: string) => void }>(),
  },
  ({ step, steps }) =>
    steps({ send: step({ run: ({ context, deps }) => deps.mail.send(context.to) }) }),
)
const notifyWithMail = notify.provide({ mail: { send: async () => {} } })
assert<Equal<RequiredDepsOf<typeof notifyWithMail>, { log: (m: string) => void }>>()
export const signupFlow = defineWizard(
  {
    name: 'signup-flow',
    context: z.object({ email: z.string() }),
    deps: boundary.trusted<{ log: (m: string) => void }>(),
  },
  ({ flow, steps }) =>
    steps({
      notify: flow(notifyWithMail, { context: ({ context }) => ({ to: context.email }) }),
    }),
)
export const missingDeps = defineWizard(
  { name: 'missing', context: z.object({ email: z.string() }) },
  ({ flow, steps }) =>
    steps({
      // @ts-expect-error ; the parent has no `log`, so a deps mapper is required
      notify: flow(notifyWithMail, { context: ({ context }) => ({ to: context.email }) }),
    }),
)
export const perItem = defineWizard(
  { name: 'per-item', context: z.object({ emails: z.array(z.string()) }) },
  ({ flow, steps }) =>
    steps({
      notifyAll: flow(notifyWithMail, {
        each: ({ context }) => context.emails,
        concurrency: 4,
        context: ({ item }) => ({ to: item }),
        deps: () => ({ log: () => {} }),
      }),
    }),
)

// 10. Mistakes stay local: one typo errors on its line and never collapses the wizard
export const typo = defineWizard({ name: 'typo', context: z.object({}) }, ({ step, steps }) =>
  steps({
    // @ts-expect-error ; unknown step id
    a: step({ run: () => 1, next: 'bb' }),
    b: step({ run: () => 2 }),
  }),
)
assert<Equal<StepId<typeof typo>, 'a' | 'b'>>() // ids survive the typo above
export const badStart = defineWizard(
  { name: 'bad-start', context: z.object({}) },
  ({ step, steps }) =>
    steps(
      { a: step({ run: () => 1 }) },
      // @ts-expect-error ; unknown start id
      { start: 'zzz' },
    ),
)
assert<Equal<StepId<typeof badStart>, 'a'>>()
export const excess = defineWizard({ name: 'excess', context: z.object({}) }, ({ step, steps }) =>
  steps({
    // @ts-expect-error ; misspelled option is an excess-property error, not a bogus overload error
    a: step({ run: () => 1, nxt: 'a' }),
  }),
)
export const foreignNeed = defineWizard(
  { name: 'foreign', context: z.object({}) },
  ({ step, steps }) => {
    const local = step({ run: () => 1 })
    return steps({
      local,
      // @ts-expect-error ; a need must be a step of this wizard (bound to the same context/events/deps)
      join: step({ needs: { x: foreign }, run: () => 0 }),
    })
  },
)
declare const otherApi: StepApi<{ other: true }, {}, unknown>
const foreign = otherApi.step({ run: () => 1 })

// 10b. Step modules: an ordinary function returns steps for any wizard; refs are checked on assembly
function auditSteps<C, Ev, D>({ step }: StepApi<C, Ev, D>) {
  return { audit: step({ run: () => 'recorded' as const }) }
}
export const withModule = defineWizard(
  { name: 'with-module', context: z.object({ id: z.string() }) },
  (api) => api.steps({ load: api.step({ run: () => 1, next: 'audit' }), ...auditSteps(api) }),
)
assert<Equal<StepId<typeof withModule>, 'load' | 'audit'>>()

// 11. Outcomes
export function s11(outcome: RunOutcome<typeof approval>) {
  switch (outcome.status) {
    case 'done':
      return outcome.output
    case 'waiting':
      for (const w of outcome.waitingFor) {
        if (w.path.length === 0 && w.kind === 'event')
          expectType<readonly ('approved' | 'rejected')[]>(w.events)
      }
      return outcome.snapshot
    case 'halted':
      return outcome.failure.step
    case 'failed':
    case 'cancelled':
      return outcome.status
  }
}

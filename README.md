# OpenWizard

[![CI](https://github.com/abcdmku/wizard/actions/workflows/ci.yml/badge.svg)](https://github.com/abcdmku/wizard/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-abcdmku.github.io%2Fwizard-0a0a0a)](https://abcdmku.github.io/wizard/)

A workflow orchestrator for TypeScript. You define the flow once as data, then drive it with one live object where every method, step id and payload is typed by that definition, on a server, in the browser or at the edge.

Data only gets in through boundaries you declare, a failed parse comes back as `{ ok: false, issues }` rather than a throw, and every change is a typed domain event you can observe, log and replay. The core is framework-agnostic with no runtime dependencies, and `size-limit` fails CI if it grows past 36 kB min+brotli.

## Install

```sh
pnpm add @openwizard/core zod   # or npm / yarn / bun. Zod 4, Valibot, ArkType: any Standard Schema
pnpm add @openwizard/react      # optional React binding
# test helpers live in @openwizard/core/testing, a separate entry, so they stay out of your bundle
```

Node 20 or newer, or any ES2022 runtime. ESM and CommonJS both ship, but the quickstart uses top-level `await`, so run it as ESM (`"type": "module"` in your `package.json`, or an `.mts` file).

## Quickstart

`onboarding.ts` is `examples/01-happy-path/src/onboarding.ts` verbatim, and CI keeps the two identical: a form view, a task that calls a CRM, a final step.

```ts title="examples/01-happy-path/src/onboarding.ts"
import { boundary, defineFlow } from '@openwizard/core'
import { z } from 'zod'

/** What the flow knows: facts you have at creation plus what the wizard collects on the way. */
const Context = z.object({
  email: z.email(), // known when the wizard is created (the sign-up form)
  company: z.string().optional(), // collected by the `profile` view
  role: z.enum(['founder', 'engineer', 'other']).optional(),
})
type Contact = z.infer<typeof Context>

/** Services outside the flow (here a CRM), injected with `createWizard(flow, { deps })`. */
export interface Deps {
  crm: { upsert(contact: Contact): { id: string } }
}

// `defineFlow` returns pre-bound step constructors: every hook below already knows the
// context and deps types, so you never write a generic or a cast.
const s = defineFlow({
  name: 'onboarding',
  context: Context,
  deps: boundary.trusted<Deps>(), // deps are built by the host, so no runtime check
})

export const onboarding = s.steps(
  {
    // A view waits for the user. `setInput()` fills the draft; `next()` parses it through
    // `input` (Zod here, any Standard Schema works) and rejects with issues, never throws.
    profile: s.view({
      input: z.object({
        company: z.string().min(1, 'company is required'),
        role: z.enum(['founder', 'engineer', 'other']),
      }),
      // The parsed draft is handed to later steps through the typed context.
      exit: ({ output, update }) => update(output),
      next: 'save',
    }),
    // A task runs as soon as the cursor arrives; sync or async, same code path.
    save: s.task(({ context, deps }) => deps.crm.upsert(context), { next: 'done' }),
    // A final step ends the flow; its `output` becomes the wizard's output.
    done: s.final({ output: ({ context }) => `${context.email} @ ${context.company}` }),
  },
  { start: 'profile' },
)
```

`main.ts` creates the wizard, watches the events, and walks it to the end.

```ts
// main.ts, run with: npx tsx main.ts (or compile with tsc and run: node main.js)
import { createWizard } from '@openwizard/core'
import { type Deps, onboarding } from './onboarding'

const deps: Deps = { crm: { upsert: (contact) => ({ id: `crm_${contact.email}` }) } }
const wizard = createWizard(onboarding, { context: { email: 'ada@example.com' }, deps })
wizard.observe((event) => console.log(event.seq, event.type)) // every domain event, typed

await wizard.start() // the cursor lands on 'profile'
await wizard.next() // { ok: false, code: 'INVALID_INPUT', issues: [...] }, a value, not a throw
await wizard.setInput('profile', { company: 'Acme', role: 'engineer' })
await wizard.next() // { ok: true, from: 'profile', to: 'save' }, the task ran, the flow is done

wizard.getState().steps.save.output // { id: string } | undefined, typed from the task's `run`
wizard.getState().output // string | undefined, typed from the final step
wizard.explain('save') // { status: 'done', phase: undefined, reasons: [], candidates: [] }
```

That first `next()` fails on purpose: the draft is empty, and the Zod issues come back as a value. The flow types everything you can call, so `setInput('typo', ...)`, `go('save')` (not a view) and `send('unknown-event', ...)` are compile errors.

```sh
npx tsx main.ts   # prints the events, then the state
```

## Concepts in 2 minutes

### Steps

A flow is a map of steps built by six pre-bound constructors. `next` is a navigation edge, meaning where completion arrives; `dependsOn` is data readiness, meaning what has to finish first.

| Kind | Enters when | Completes when | Notable options |
|---|---|---|---|
| `s.view(cfg)` | the cursor arrives (`start` / `next` / `go` / `back`) | `next()` parses the draft through `input`, then `validate`, `canExit` | `input`, `initial`, `validate`, `canEnter`, `canExit`, `enter`, `exit`, `next` |
| `s.task(run, opts)` | it is ready (auto-run) | `run` settles (optionally re-checked by `output`) | `retry`, `timeout`, `compensate`, `output`, `idempotent`, `mapError`, `next`, `dependsOn` |
| `s.wait(cfg)` | it is ready | an `on[event]` handler resolves or `timeout.after` fires | `on`, `timeout: { after, next }`, `next` |
| `s.decision(cfg)` | it is ready | `next(args)` returns a target | `next` (function), `dependsOn` |
| `s.flow(child, cfg)` | it is ready, a child wizard is created | the child reaches a `final` | `context` (parent to child), `deps`, `output`, `exit`, `next` |
| `s.final(cfg)` | it is ready | immediately; the flow is `done` | `output` |

Every kind also takes `on` handlers for events that arrive while it is active. Every kind but `final` takes a `when` predicate that skips the step when it returns false.

### Boundaries

Four doors let data in, and each parses before anything is stored: `context` at `createWizard`, a view's `input` on `next()`, `events[name]` on `send()`, then all of them again on `resumeWizard()`.

```ts
const s = defineFlow({
  name: 'signup',
  context: z.object({ email: z.email() }), // any Standard Schema: Zod 4, Valibot, ArkType
  events: { 'payment.captured': z.object({ paymentId: z.string() }) },
  deps: boundary.trusted<Deps>(), // you build deps yourself, so no runtime check
})
```

Hand-written checkers are `boundary.parse(fn)`, `boundary.guard(fn)` and `boundary.assert(fn)`; a task's `output` is an optional fifth check for values coming back from other systems.

### Policies

Failure handling is data on the definition rather than code paths, so `inspect()` can show it. The policies stay in the flow; what a snapshot carries is the resulting state, like `attempt`, `retryAt` and the saga stack.

```ts
s.task(charge, {
  retry: { attempts: 3, backoff: 'exponential' }, // waits 200, 400, 800 ms
  timeout: '30s',
  compensate: ({ output, deps }) => deps.payments.refund(output.chargeId), // the undo
})
```

Flow-level knobs: `onFailure: 'halt' | 'compensate'`, `autoRun: 'ready' | 'manual'`, `concurrency`, and `unmatchedEvents: { buffer, ttl }`, the inbox for webhooks that arrive early.

### Results are values

`next()`, `back()` and `go()` return a `NavResult`, `send()` a `SendResult`, and the other command methods a `CommandResult`. Queries like `getState()` and `explain()` just return their value.

```ts
await wizard.next() // { ok: false, reason: 'validation', code: 'INVALID_INPUT', issues: [...] }
await wizard.send('payment.captured', body) // { ok: false, reason: 'rejected', code: 'BOUNDARY_REJECTED' }
```

`WizardError` is thrown only for programmer errors: unknown event names, invalid definitions, incompatible snapshots, disposed wizards.

### Snapshots and resume

Give the wizard a `Store` and it auto-saves a versioned snapshot after every change, JSON-checking each write first, so a `Date` outside a reviving boundary is reported with its path instead of being silently distorted.

```ts
const wizard = createWizard(flow, { context, deps, store, key: 'order-1' }) // saves after every change
const resumed = resumeWizard(flow, await store.get('order-1'), { deps, store, key: 'order-1' })
// re-validates every boundary, bumps `epoch`, re-arms timers from their absolute deadlines,
// and fails a task the crash interrupted with `kind: 'interrupted'` unless it was `idempotent`
```

A snapshot of an older flow `version` resumes through `{ migrate }`. Persistence is single-owner, one live wizard per key, so only resume on another replica once the first one is gone.

### Projections and clients

`defineProjection(flow, { expose })` is deny-by-default: only the step fields and context keys you list cross the wire, with `select: (state) => T` as the escape hatch.

```ts
export const checkoutClient = defineProjection(checkout, {
  expose: {
    steps: { shipping: { input: true, issues: true }, charge: { error: true } },
    context: ['total', 'express'],
    output: true,
  },
})
```

`dispatch(command)` is the one wire door, typed by the flow, with `parseCommand(flow, body)` turning untrusted JSON into one. `createMirrorSource(wizard, projection)` on the server and `createMirror({ transport })` on the client give the browser a read-only replica with the same typed commands, and [`@openwizard/react`](packages/react/README.md) turns that into hooks with `bindReact()`.

### Observability

`observe(listener)` streams every domain event with `seq`, `at`, `path` and `causedBy`, child flows included. `log()` is the root wizard's own bounded ring, so it holds root events only.

```ts
wizard.observe((event) => console.log(event.seq, event.type, event.path))
wizard.explain('gate') // { phase: 'blocked', reasons: ['deps-unmet:enrich'], candidates: [] }
console.log(toMermaid(inspect(flow))) // the static graph as a Mermaid flowchart you can commit
```

`wizard.progress()` and `readyViews()` cover the usual UI questions.

## Examples

Each example is a workspace package with tests that drive it end to end. Most assert on the event log; 09 asserts on the rendered graph and 08 and 10 drive their React UI through the DOM.

| Example | Shows |
|---|---|
| [01-happy-path](examples/01-happy-path) | view, task, final, typed input, `deps`, validation as values, the sync-commit guarantee, `getSnapshot()` |
| [02-recoverable-failure](examples/02-recoverable-failure) | `retry: { attempts, backoff: 'exponential' }` on virtual time, exhausted retries then `retry(step)`, `idempotent`, `mapError` |
| [03-non-recoverable-compensation](examples/03-non-recoverable-compensation) | `onFailure: 'compensate'`: reverse-order unwind, `saga.failures`, `compensate({ from })` |
| [04-resume-from-snapshot](examples/04-resume-from-snapshot) | auto-save, crash, `resumeWizard()`, re-armed timers, interrupted task then `retry()`, snapshot `migrate` |
| [05-external-events](examples/05-external-events) | webhooks through an event boundary, early events buffered in the inbox, TTL, wait timeout, correlation ids |
| [06-nested-flow](examples/06-nested-flow) | `s.flow(child, { context })`, `wizard.child()`, child events with `path`, nested snapshots, `mirror.child()` |
| [07-dag-pipeline](examples/07-dag-pipeline) | fan-out, parallel tasks under `concurrency`, AND-join with `dependsOn`, `explain()`, `when`, `skip()` |
| [08-react-mirror](examples/08-react-mirror) | Vite + React where the UI only touches a `Mirror`, over a deny-by-default projection, with a jsdom test |
| [09-mermaid](examples/09-mermaid) | `toMermaid(inspect(flow))`: kinds, `next` / `dependsOn` / `timeout` edges, a dynamic `next`, a child subgraph |
| [10-devtools](examples/10-devtools) | example 07 under the [`@openwizard/devtools`](packages/devtools/README.md) panel: live graph, event log, inspector, timeline |

```sh
pnpm install && pnpm build
pnpm examples                                   # typecheck + test every example against the built package
pnpm --filter example-07-dag-pipeline start     # run one example's walk-through
```

## Documentation

- [abcdmku.github.io/wizard](https://abcdmku.github.io/wizard/) is the docs site: getting started, concepts, examples, the API reference and a playground that runs examples 01 to 07 and 09 in the browser. `pnpm docs:dev` runs it locally.
- [`packages/core/README.md`](packages/core/README.md) is the API reference, from the authoring shape to the guarantees, with the generated export table.
- [`docs/design/architecture-plan.md`](docs/design/architecture-plan.md) is binding for the engine, [`docs/design/machine-spec.md`](docs/design/machine-spec.md) specifies the pure machine, and [`docs/design/adr/`](docs/design/adr) holds the decision records, indexed by [`DECISIONS.md`](DECISIONS.md).
- [`CONTRIBUTING.md`](CONTRIBUTING.md) has the few rules that keep the library small, and [`SECURITY.md`](SECURITY.md) says what the library guarantees and what you still have to do yourself.

## License

MIT

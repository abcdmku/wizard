# OpenWizard

[![CI](https://github.com/abcdmku/wizard/actions/workflows/ci.yml/badge.svg)](https://github.com/abcdmku/wizard/actions/workflows/ci.yml)

**A TypeScript-first, type-safe orchestrator for sync and async workflows — on the server, in the browser, at the edge.**

Define a flow once (views, tasks, waits, decisions, nested flows, finals) and drive it with one
live object whose every method, id and payload is typed by that definition. Data enters only
through declared **boundaries** (any Standard Schema — Zod, Valibot, ArkType — or a branded
checker), so a webhook body, a form draft or a snapshot loaded from a database can never
poison the state. Every change is a typed **domain event** you can observe, log and replay;
every question — "why can't I go there?" — has a stable answer (`explain()`). Snapshots are
JSON-checked before every store write, resume re-validates everything, and deny-by-default
**projections** are what a client sees.

- **Sync + async, one code path.** A step's hooks may return values or promises; when they are synchronous the state is committed before your call returns.
- **Backend + frontend.** Framework-agnostic core with no runtime dependencies (< 32 kB min+brotli, enforced by `size-limit`). Persist on the server, project to the client, bind in React (`@openwizard/react`).
- **Boundaries as the only doors.** `context`, `setInput`, `send`, `resume` — each parsed by a schema you declared. Rejections are values (`{ ok: false, issues }`), never throws.
- **Deep observability.** `observe()` / `log()` stream domain events (with causal `seq`, `path` for nested flows); `inspect()` gives the static graph; `explain()` the live reasons.

## Install

```sh
pnpm add @openwizard/core zod    # or npm / yarn / bun — Zod 4, or any Standard Schema library
pnpm add @openwizard/react       # optional React binding
```

Node ≥ 20 (or any ES2022 runtime), ESM (`"type": "module"` in your `package.json`, or `.mts`
files). Test helpers (`createTestScheduler`, `createLocalTransport`) are a separate entry,
`@openwizard/core/testing`.

## Quickstart

Two files. `onboarding.ts` below is `examples/01-happy-path/src/onboarding.ts`, copied verbatim
(CI keeps them identical): a form, a task that calls an out-of-domain service, a final step.

```ts title="examples/01-happy-path/src/onboarding.ts"
import { boundary, defineFlow } from '@openwizard/core'
import { z } from 'zod'

/** The flow context: known facts at creation plus what the wizard collects along the way. */
const Context = z.object({
  email: z.email(), // known when the wizard is created (the sign-up form)
  company: z.string().optional(), // collected by the `profile` view
  role: z.enum(['founder', 'engineer', 'other']).optional(),
})
type Contact = z.infer<typeof Context>

/** Out-of-domain services the flow calls, injected with `createWizard(flow, { deps })`. */
export interface Deps {
  crm: { upsert(contact: Contact): { id: string } }
}

// `defineFlow` returns pre-bound step constructors: every hook below is typed by this
// context / deps without generics or casts.
const s = defineFlow({
  name: 'onboarding',
  context: Context,
  deps: boundary.trusted<Deps>(), // deps are built by the host, so no runtime check
})

export const onboarding = s.steps(
  {
    // A view waits for the user: `setInput()` fills the draft, `next()` parses it through
    // `input` (Zod here — any Standard Schema works) and rejects with issues, never throws.
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

`main.ts` drives it (top-level `await`, so ESM):

```ts
// main.ts — run with: npx tsx main.ts   (or compile with tsc and run `node main.js`)
import { createWizard } from '@openwizard/core'
import { type Deps, onboarding } from './onboarding'

const deps: Deps = { crm: { upsert: (contact) => ({ id: `crm_${contact.email}` }) } }
const wizard = createWizard(onboarding, { context: { email: 'ada@example.com' }, deps })
wizard.observe((event) => console.log(event.seq, event.type)) // every domain event, typed

await wizard.start() //            → the cursor is on 'profile'
await wizard.next() //             → { ok: false, code: 'INVALID_INPUT', issues: [...] } — a value, not a throw
await wizard.setInput('profile', { company: 'Acme', role: 'engineer' })
await wizard.next() //             → { ok: true, from: 'profile', to: 'save' }; task ran; flow done

wizard.getState().steps.save.output // { id: string } | undefined — typed from the task's `run`
wizard.getState().output // string | undefined — typed from the final step
wizard.explain('save') // { status: 'done', phase: undefined, reasons: [], candidates: [] }
```

```sh
npx tsx main.ts     # prints the events, then the state
```

Everything you can call is typed by `onboarding`: `setInput('typo', …)`, `go('save')` (not a
view) or `send('unknown-event', …)` are compile errors, and every id in a `next` / `dependsOn` is
checked when the flow is assembled.

## Concepts in 2 minutes

**Steps.** A flow is a map of steps built by six pre-bound constructors. `next` is a navigation
edge (where completion arrives), `dependsOn` is data readiness (what must be done first) — one
rule covers wizards, DAGs and hybrids.

| Kind | Enters when | Completes when | Notable options |
|---|---|---|---|
| `s.view(cfg)` | the cursor arrives (`start` / `next` / `go` / `back`) | `next()` parses the draft through `input`, then `validate`, `canExit` | `input`, `initial`, `validate`, `canEnter`, `canExit`, `enter`, `exit`, `next` |
| `s.task(run, opts)` | it is ready (auto-run) | `run` settles (optionally re-checked by `output`) | `retry`, `timeout`, `compensate`, `output`, `next`, `dependsOn` |
| `s.wait(cfg)` | it is ready | an `on[event]` handler resolves or `timeout.after` fires | `on`, `timeout: { after, next }`, `next` |
| `s.decision(cfg)` | it is ready | `next(args)` returns a target | `next` (function), `dependsOn` |
| `s.flow(child, cfg)` | it is ready → child wizard created | the child reaches a `final` | `context` (parent → child), `deps`, `output`, `exit`, `next` |
| `s.final(cfg)` | it is ready | immediately; the flow is `done` | `output` |

**Boundaries.** `Boundary<O, I> = StandardSchema | Checker` — `boundary.parse(fn)`,
`boundary.guard(fn)`, `boundary.assert(fn)`, `boundary.trusted<T>()` (no runtime check; grep-able).
Four doors, each with a declared boundary: `context` at `createWizard`, a view's `input` on
`next()` / `go()`, `events[name]` on `send()`, and everything again on `resumeWizard()`. A task's
`output` is an optional fifth check on values returning from other systems.

**Policies (data, not code paths).** `onFailure: 'halt' | 'compensate'` (halt keeps `retry()`
possible; compensate unwinds completed steps in reverse order, best effort), `retry: { attempts,
backoff }` per task or per flow, `timeout` per task, `autoRun: 'ready' | 'manual'` (+ `runReady()`),
`concurrency`, `unmatchedEvents: { buffer, ttl }` (the "webhook arrived early" inbox).

**Results are values.** `next()` / `back()` / `go()` → `NavResult`; `send()` → `SendResult`;
everything else → `CommandResult`. Validation failures, guards, busy navigation, terminal flows
are all `{ ok: false, code, … }`. `WizardError` is thrown only for programmer errors (unknown
event names, invalid definitions, incompatible snapshots, disposed wizards).

**Snapshots & resume.** `getSnapshot()` is a versioned envelope (`{ v, flow, instanceId, epoch,
seq, savedAt, state, children }`); a `Store` (`createMemoryStore()` or yours) auto-saves it after
every change — JSON-checked before every write (a `Date` outside a reviving boundary, a `Map`, a
function, … is reported with its path instead of being distorted); `resumeWizard(flow, unknown,
options)` re-validates everything, bumps `epoch`, re-arms timers and applies the recovery matrix
(interrupted tasks fail with `kind: 'interrupted'`, waits keep their deadlines, in-flight
navigation is rejected). Persistence is single-owner in v0.1: one live wizard per key, no
compare-and-swap — resume on another replica only after the first is gone.

**Projections & clients.** `defineProjection(flow, { expose })` is deny-by-default: only the
listed step inputs / outputs / issues / errors / children, context keys and (if asked) the flow
output cross the wire; `wizard.project(p)` returns the typed `ClientState`. `dispatch(command)`
is the one wire door, typed by the flow (`Command<F>`); untrusted JSON becomes one through
`parseCommand(flow, body)`.
The client half is in core too: `createMirrorSource(wizard, projection)` on the server,
`createMirror({ transport })` on the client (a read-only replica with the same typed command
sugar), `createLocalTransport()` (from `@openwizard/core/testing`) for tests, and `Frame` /
`WireCommand` / `WireAck` (with `parseWireCommand` / `parseFrame`) as the wire shapes. The React hooks (`bindReact<typeof projection>()` → `Provider`, `useStep`, `useSelector`,
`useActions`, …) live in [`@openwizard/react`](packages/react/README.md).

**Observability.** `observe(listener)` / `log()` — every domain event with `seq`, `at`, `path`
(nested flows) and `causedBy`; `inspect(flow)` — nodes, edges (`next` / `dependsOn` / `timeout`),
warnings; `wizard.explain(step)` — `{ status, phase, reasons: ['deps-unmet:enrich', …], candidates }`.

## Examples (each is a workspace package and a test)

| Example | Shows |
|---|---|
| [01-happy-path](examples/01-happy-path) | view → task → final, typed input, `deps`, validation as values, the sync-commit guarantee, `getSnapshot()` |
| [02-recoverable-failure](examples/02-recoverable-failure) | `retry: { attempts, backoff: 'exponential' }` driven by `createTestScheduler()`, exhausted retries → `retry(step)` |
| [03-non-recoverable-compensation](examples/03-non-recoverable-compensation) | `onFailure: 'compensate'`: reverse-order unwind, `saga.failures`, `compensate({ from })` |
| [04-resume-from-snapshot](examples/04-resume-from-snapshot) | auto-save to a store, crash, `resumeWizard()`, re-armed timers, interrupted task → `retry()` |
| [05-external-events](examples/05-external-events) | webhooks through an event boundary, early events buffered in the inbox, TTL, wait timeout |
| [06-nested-flow](examples/06-nested-flow) | `s.flow(child, { context })`, `wizard.child()`, child events with `path`, nested snapshots |
| [07-dag-pipeline](examples/07-dag-pipeline) | fan-out, parallel tasks under `concurrency`, AND-join with `dependsOn`, `explain()`, `autoRun: 'manual'` |
| [08-react-mirror](examples/08-react-mirror) | Vite + React: the UI touches only a `Mirror` (deny-by-default projection over a loopback transport) via `bindReact()` hooks; tokenised payment, headless jsdom test |

```sh
pnpm install && pnpm build
pnpm examples                                   # typecheck + test every example against the built package
pnpm --filter example-07-dag-pipeline start     # run one example's walk-through
```

## Documentation

- [`packages/core/README.md`](packages/core/README.md) — the API reference: authoring shape, step kinds, hooks, boundaries, `createWizard`, `Wizard` methods, persistence, projections, testing, guarantees, and the generated export table.
- [`docs/design/architecture-plan.md`](docs/design/architecture-plan.md) — architecture and semantics (binding for the engine); [`docs/design/machine-spec.md`](docs/design/machine-spec.md) — the pure machine; [`docs/design/adr/`](docs/design/adr) — decision records ([`DECISIONS.md`](DECISIONS.md) is the index).
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — the few rules that keep the library small; [`SECURITY.md`](SECURITY.md) — what the library guarantees about persistence and client exposure, and what you must do.

## License

MIT

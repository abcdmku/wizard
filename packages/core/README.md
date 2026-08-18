# @openwizard/core

A TypeScript-first, type-safe orchestrator for sync and async workflows. Framework-agnostic,
no runtime dependencies; runs on the server, in the browser and at the edge. This document is
the API reference; the [root README](../../README.md) has the pitch and the concepts, the
[examples](../../examples) are tested walk-throughs.

```sh
pnpm add @openwizard/core zod   # any Standard Schema library works; the examples use Zod 4
```

Bring your own schema library — any [Standard Schema](https://standardschema.dev) (Zod 4,
Valibot, ArkType, …) is a boundary. Node ≥ 20 or any ES2022 runtime. Test helpers
(`createTestScheduler`, `createLocalTransport`) live in the `@openwizard/core/testing` entry
so they never end up in an application bundle (§10).

## Contents

1. [Define a flow](#1-define-a-flow) — `defineFlow`, the builder, flow options
2. [The six step kinds](#2-the-six-step-kinds) — options per kind
3. [Hook arguments](#3-hook-arguments)
4. [Boundaries](#4-boundaries) — `boundary.parse / guard / assert / trusted`, Standard Schema
5. [Run it: `createWizard`](#5-run-it-createwizard) — options
6. [The `Wizard`](#6-the-wizard) — every method and its result type
7. [Events, `explain`, `inspect`](#7-events-explain-inspect)
8. [Persistence](#8-persistence) — `Store`, `createMemoryStore`, JSON-checked writes, `resumeWizard`, recovery matrix, single-owner
9. [Projections and the wire door](#9-projections-and-the-wire-door) — `defineProjection`, `dispatch`, `parseCommand`, the Mirror
10. [Testing with `@openwizard/core/testing`](#10-testing-with-openwizardcoretesting) — `createTestScheduler`, `createLocalTransport`
11. [Guarantees](#11-guarantees)
12. [Exports](#exports) — generated table

## 1. Define a flow

`defineFlow(options)` returns a `FlowBuilder`: the six step constructors, **pre-bound** to the
flow's context / events / deps (so every hook is typed without generics), plus `steps()` which
assembles the inert `Flow`. Every step id referenced by `next`, `dependsOn`, `timeout.next` or
`start` is checked at compile time — the error lands on the offending property
(`step 'a' references unknown step id(s): 'typo'`) — and again at runtime for JS callers.

```ts
import { boundary, defineFlow } from '@openwizard/core'
import { z } from 'zod'

interface Deps {
  inventory: {
    reserve(cartId: string): Promise<{ reservationId: string }>
    release(reservationId: string): Promise<void>
  }
}

const s = defineFlow({
  name: 'checkout', //                                  persistence identity (with `version`)
  version: 1,
  context: z.object({ cartId: z.string(), total: z.number(), paymentId: z.string().optional() }),
  events: { 'payment.captured': z.object({ paymentId: z.string() }) },
  deps: boundary.trusted<Deps>(), //                    built by the host → no runtime check
  onFailure: 'compensate',
})

export const checkout = s.steps(
  {
    shipping: s.view({ input: z.object({ address: z.string().min(1) }), next: 'reserve' }),
    reserve: s.task(({ context, deps }) => deps.inventory.reserve(context.cartId), {
      retry: { attempts: 3, backoff: 'exponential' },
      compensate: ({ output, deps }) => deps.inventory.release(output.reservationId),
      next: 'awaitPayment',
    }),
    awaitPayment: s.wait({
      on: { 'payment.captured': ({ payload, update }) => update({ paymentId: payload.paymentId }) },
      timeout: { after: '15m', next: 'expired' },
      next: 'route',
    }),
    route: s.decision({ next: ({ context }) => (context.paymentId ? 'receipt' : 'expired') }),
    receipt: s.final({ output: ({ context }) => ({ paymentId: context.paymentId }) }),
    expired: s.final(),
  },
  { start: 'shipping' },
)
```

`defineFlow` options (`FlowDefinition`):

| Option | Type | Meaning |
|---|---|---|
| `name` | `string` (required) | Flow identity; with `version` it is checked on resume. |
| `version` | `number` (default `1`) | Bump when the step set changes incompatibly. |
| `context` | `Boundary<C, CIn>` (required) | Parsed at `createWizard({ context })` and on resume. `boundary.trusted<C>()` for defaults you already trust. |
| `events` | `{ [name]: Boundary }` | Declares `send(name, payload)` and the `on` handlers of wait steps. |
| `deps` | `Boundary<D>` | Declares `createWizard({ deps })` (required iff present); hooks receive `deps`. |
| `onFailure` | `'halt' \| 'compensate'` (default `'halt'`) | What happens when a task fails with no retries left. |
| `retry` | `RetryPolicy` | Default retry policy for tasks. |
| `autoRun` | `'ready' \| 'manual'` (default `'ready'`) | Ready non-view steps start automatically, or on `runReady()`. |
| `concurrency` | `number` (default `Infinity`) | Maximum tasks running at once. |
| `unmatchedEvents` | `{ buffer: boolean; ttl: Duration }` (default buffer for `'5m'`) | Events with no active listener are buffered (FIFO) or dropped. |

`s.steps(defs, { start })` — `start` defaults to the first declared step (a string, or an
array for several entry points). The returned `Flow` is inert data; `inspect(flow)` shows its
graph and `createWizard(flow, …)` runs it. Extractors read the phantom types: `StepId<F>`,
`ViewId<F>`, `TaskId<F>`, `ChildStepId<F>`, `Ctx<F>`, `ContextInput<F>`, `DepsOf<F>`,
`EventType<F>`, `PayloadOf<F, E>`, `InputOf<F, K>`, `DraftOf<F, K>`, `OutputOf<F, K>`,
`ChildFlowOf<F, K>`, `FlowOutput<F>` — exactly one per concept.

`RetryPolicy` (plain data, so `inspect()` can show it): `{ attempts, backoff?, baseMs?, factor?,
maxBackoffMs? }` — `attempts` retries after the first failure (`attempts: 1` = one retry, two
runs); `backoff` a fixed number of ms (absent = immediately) or `'exponential'` =
`min(baseMs × factor^(attempt-1), maxBackoffMs)` with defaults 200 ms / 2 / 30 s. The policy is
code (it lives in the flow definition); what persists is the retry *state* — `attempt` and the
`retryAt` deadline — which resume re-arms. `Duration` is a number of ms or `'250ms' | '15s' | '15m' | '2h' | '1d'`.

## 2. The six step kinds

`next` is a **navigation edge** — where completion arrives: one id, an array (fan-out) or a
function of the step's output (a `NextRef` or a promise of one). `dependsOn` is **data
readiness** — an arrived step only becomes ready once every listed step is done (`{ any: [...] }`
for an OR-join). Both accept step ids only. `label` is free text for tooling.

**`s.view(cfg)`** — waits for a user; the cursor (`getState().current`) is the active view.

| Option | Meaning |
|---|---|
| `input?: Boundary<O, I>` | The draft (`setInput` patches, `DraftOf` = INPUT side, partial) is parsed on `next()` / `go()`; the OUTPUT side is what hooks and `steps[k].output` see. |
| `initial?: Partial<I>` | Seeds the draft on first entry. |
| `validate?: (a: OutputArgs) => void \| Issue[]` | Runs after `input` parsed; issues reject the transition (`INVALID_INPUT`). |
| `canEnter?`, `canExit?: (a) => boolean` | Guards; a `false` rejects with `GUARD_BLOCKED`. Fan-out evaluates every target's `canEnter` first (atomic). |
| `enter?`, `exit?` | Effects on entering / leaving (`exit` sees `output`, `to`, `direction`). |
| `next?`, `dependsOn?` | As above. |

**`s.task(run, options?)`** — runs when ready. `run` may return a value or a promise; its type
is the step's output (`OutputOf<F, K>`) unless `options.output` re-checks it.

| Option | Meaning |
|---|---|
| `output?: Boundary<O, unknown>` | Re-check the value returning from another system; a rejection fails the task with the issues. |
| `retry?: RetryPolicy` | Overrides the flow default. Retries are timers (`step.retryScheduled { dueAt }`): the attempt counter and the deadline persist and are re-armed on resume; the policy itself is read from the flow. |
| `timeout?: Duration` | Aborts the run (`signal`), then fails with `kind: 'timeout'` after the retries. |
| `compensate?: (a: CompensateArgs) => unknown` | Undo hook for `onFailure: 'compensate'` / `cancel()`; receives the task's own `output`. |
| `enter?`, `exit?`, `next?`, `dependsOn?` | As above. |

**`s.wait(cfg)`** — waits for an external event (`send()`) or a deadline. Output:
`{ event, payload }` for the resolving event, plus `{ event: 'timeout' }` when the step declares
a `timeout` (`WaitOutput<Ev, T>` — a wait without `timeout` never sees the marker).

| Option | Meaning |
|---|---|
| `on: { [event]: (a: EventArgs) => void \| { next?: id } }` (required) | One handler per event the step listens for (payload already parsed). Returning `{ next }` overrides the static `next`; a throw fails the step (`kind: 'hook'`). |
| `timeout?: { after: Duration; next: id }` | Absolute `deadline` in state; fires `timer.fired` and routes to `next`. |
| `enter?`, `exit?`, `next?`, `dependsOn?` | As above. |

**`s.decision(cfg)`** — `next: (a) => NextRef` (required) chooses the target(s) from context /
output; `dependsOn?` makes it a join (the gate of a DAG). Its output (`OutputOf<F, K>`,
`steps[k].output`) is the normalized list of chosen ids (`readonly N[]`: `'a'` → `['a']`,
`null` → `[]`).

**`s.flow(child, cfg)`** — embeds another flow as a step: a child wizard with its own queue,
instance id and snapshot (`Snapshot.children[step]`); events forwarded with `path`.

| Option | Meaning |
|---|---|
| `context: (a) => ContextInput<Child>` (required) | Builds the child's context INPUT — parsed by the child's context boundary exactly once, when the child is created. |
| `deps?: (a) => DepsOf<Child>` | Builds the child's deps (parsed by the child's `deps` boundary when it declares one, at creation). Omitted → the child receives the parent's `deps` object unchanged. A throwing mapper or a rejecting boundary fails the flow step (`kind: 'child'`). |
| `output?: Boundary<O, unknown>` | Re-check / retype the child's output (default `FlowOutput<Child>`). |
| `exit?`, `next?`, `dependsOn?` | As above (`exit` sees the child's output). |

Max depth 8; a flow embedding an ancestor throws `NESTING_CYCLE`. Every step kind accepts only
its own options (per-kind allow-lists — `input` on a task is `DEFINITION_INVALID`, listed with
every other problem of the whole tree, nested flows included).

**`s.final(cfg?)`** — ends the flow: `output?: (a) => O` becomes `getState().output`
(`FlowOutput<F>` = union of the finals' outputs); other active steps are cancelled.

## 3. Hook arguments

Every hook receives `BaseArgs<C, D>` and adds a little:

| Field | On | Meaning |
|---|---|---|
| `context: C` | all | The parsed flow context (typed). |
| `update(patch: Partial<C>)` | all | Patch the context (shallow merge, recorded as `context.changed`). The typed hand-off between steps. |
| `deps: D` | all | What `createWizard({ deps })` received. |
| `steps` | all | Sibling records (`SiblingStates`, an open map — status / attempt / input / output as `unknown`; use `context` for typed data). |
| `step`, `path` | all | This step's id and the wizard path (`[]` root, `['fulfil']` inside a child). |
| `signal` | all | `AbortSignalLike`; aborted on timeout, cancel, dispose. |
| `attempt` | `run` | 1-based. |
| `from` | `enter`, `canEnter` | Previous step (or `null`). |
| `output` | `validate`, `canExit`, `exit`, `next`, `compensate` | The step's parsed / produced output. |
| `to`, `direction` | `exit` | Target and `'forward' \| 'back'`. |
| `reason` | `compensate` | Why the saga runs (`cancel(reason)`), if any. |
| `event`, `payload` | `wait.on[event]` | The event name and its parsed payload. |

Every hook may be sync or async (`MaybePromise`). With `createWizard({ strict: 'sync' })` a
thenable becomes a `SYNC_VIOLATION` failure.

## 4. Boundaries

`Boundary<O, I = O> = StandardSchemaV1<I, O> | Checker<O, I>`. Plain functions are rejected
(guard or parse? ambiguous), so build a branded `Checker` when you have no schema. The brand is a
private symbol: only `boundary.*` mints checkers, a hand-written `{ '~checker': 'assert' }` is
not a boundary (`DEFINITION_INVALID`):

```ts
import { boundary } from '@openwizard/core'

const Address = boundary.parse((v) => {
  if (typeof v !== 'object' || v === null || !('city' in v)) throw new Error('city required')
  return v as { city: string } // parse: return the value (transformed) or throw
})
const IsCount = boundary.guard((v): v is number => typeof v === 'number' && v >= 0)
const AssertId = boundary.assert((v): asserts v is string => {
  if (typeof v !== 'string') throw new Error('id must be a string')
})
const Deps = boundary.trusted<{ mailer: { send(to: string): Promise<void> } }>() // no runtime check
```

Exactly four doors, each through a declared boundary — (1) `context` at
`createWizard` / `createWizardAsync`; (2) a view's `input` when `next()` / `go()` parses the
draft; (3) `send(event, payload)` through `events[event]`; (4) `resumeWizard(flow, unknown)`,
which re-runs every boundary over the snapshot — plus the optional task `output` re-check.
Rejections are events (`step.validationFailed`, `event.rejected`) and results (`issues:
Issue[]`, Standard Schema issue shape), never throws.

## 5. Run it: `createWizard`

```ts
import { createMemoryStore, createWizard } from '@openwizard/core'
import { createTestScheduler } from '@openwizard/core/testing'

const wizard = createWizard(checkout, {
  context: { cartId: 'c1', total: 42 }, // ContextInput<F>: parsed by the context boundary
  deps, //                                 required iff the flow declares `deps`
  instanceId: 'checkout-c1', //            default: generated
  store: createMemoryStore(), //           optional persistence (see §8)
  key: 'tenant-a/checkout/c1', //          default: the instance id
  autoSave: 'change', //                   default when a store is given ('off' to save() manually)
  debounceMs: 0, //                        coalesce auto-saves
  redact: (snapshot) => snapshot, //       applied right before store.set
  onPersistError: (error) => {}, //        a write failed (store error, or a non-JSON snapshot); default: rethrown async
  scheduler: createTestScheduler(), //     timers (a TestScheduler doubles as the clock)
  strict: 'sync', //                       thenables from hooks → SYNC_VIOLATION
  logSize: 200, //                         bounded event ring for log()
})
```

`createWizardAsync` is the same for flows whose context / deps boundaries are asynchronous
(`resumeWizardAsync` is the resume twin, §8). Both throw `WizardError('BOUNDARY_REJECTED')` when
the context (or deps) fails its boundary and `WizardError('DEFINITION_INVALID')` for a broken
flow — programmer errors, at the door.

## 6. The `Wizard`

Every method is sugar over `dispatch(command)`; every result is a value.

| Member | Returns | Notes |
|---|---|---|
| `id`, `epoch`, `flow` | | Instance id (default store key); resume counter; the flow. |
| `start()` | `Promise<CommandResult>` | Activates the `start` step(s). |
| `next()`, `back()`, `go(view)` | `Promise<NavResult>` | Cursor moves through the full pipeline (parse → validate → canExit → resolve → canEnter → exit → enter). |
| `setInput(view, patch)`, `resetInput(view)` | `Promise<CommandResult>` | Shallow-merge a `DraftOf<F, K>` patch / reset to `initial`. |
| `validate(view)` | `Promise<readonly Issue[]>` | Pure query: `input` boundary + `validate` hook over the current draft. No events. |
| `send(event, payload, { correlationId? })` | `Promise<SendResult>` | Payload is `unknown`; parsed by the event boundary. Unknown event name → throws `UNKNOWN_EVENT`. |
| `run(task)` | `Promise<CommandResult>` | Start one ready task now (`autoRun: 'manual'`, or a task waiting on `dependsOn`). |
| `retry(task)` | `Promise<CommandResult>` | Re-run a failed task (`attempt` resets). |
| `cancel(reason?)` | `Promise<CommandResult>` | Abort running tasks; compensate if the policy says so. |
| `runReady()` | `Promise<CommandResult>` | Start ready non-view steps under `autoRun: 'manual'`. |
| `compensate({ from?, reason? })` | `Promise<CommandResult>` | Trigger the saga, or re-attempt entries in `saga.failures` (`from`). |
| `reset()` | `Promise<CommandResult>` | Back to the initial state (`flow.reset`): steps idle, timers cleared, children disposed; the instance id stays. |
| `dispatch(command)` | `Promise<CommandResult>` | The one wire door, typed by the flow (`Command<F>`, §9). |
| `getState()` | `Snapshot<F>['state']` | Typed state: `status`, `current`, `active`, `context`, `steps[k]` (`StepState`), `history`, `saga`, `inbox`, `timers`, `output`, `seq`, `epoch`. |
| `getSnapshot()` | `Snapshot<F>` | Versioned, JSON-safe, includes children; cached per state. |
| `explain(step)` | `Explanation<F>` | Why a step is (not) where you expect (§7). |
| `subscribe(listener)` | `() => void` | State listener, once per committed batch. |
| `observe(listener)` | `() => void` | Every domain event of this wizard and its children (`WizardEvent<F>`, `event.path`). |
| `log()` | `readonly WizardEvent<F>[]` | Bounded event ring (default 200). |
| `child(step)` | `Wizard<ChildFlowOf<F, K>>` | Live child of an active flow step (throws `NOT_A_FLOW_STEP` / `NOT_ACTIVE`). |
| `project(projection)` | `ClientState<F, E>` | Client-safe state through a projection of this flow OBJECT (§9; another flow, same name or not → `DEFINITION_INVALID`). |
| `save()` | `Promise<void>` | Write a snapshot now (no-op without a store). |
| `dispose()` | `void` | Stops timers, aborts runs, settles pending promises with `DISPOSED`. |

Result types:

```ts
import type { CommandResult, NavResult, SendResult } from '@openwizard/core'
// CommandResult = { ok: true; seq } | { ok: false; code; message; step?; issues? }
// NavResult     = { ok: true; from; to; seq }
//               | { ok: false; reason: 'validation' | 'guard-canExit' | 'guard-canEnter' | 'nav-busy'
//                            | 'not-a-view' | 'not-active' | 'not-reachable' | 'no-target' | 'no-history'
//                            | 'flow-terminal' | 'flow-not-started' | …; code; message; step?; issues? }
//               | { ok: false; reason: 'failed'; code: WizardErrorCode | 'HOOK_FAILED'; message; step?; error? }
// SendResult    = { ok: true; delivered: string[]; buffered: boolean; seq }
//               | { ok: false; reason: 'rejected'; code: 'BOUNDARY_REJECTED'; message; issues }
//               | { ok: false; reason: 'dropped'; code: 'NOT_ACTIVE' | 'DISPOSED' | 'FLOW_TERMINAL' | …; message }
```

One vocabulary: every `{ ok: false }` result carries `code` (a `WizardErrorCode`, plus `STALE` /
`FLOW_COMPENSATING` / `HOOK_FAILED` where they apply) and `message`; `dispatch({ type: 'send' })`
returns the same `code` a `send()` would, as a `CommandResult`. `WizardError` (with a stable
`code: WizardErrorCode`, `isWizardError(e)`) is thrown only for misuse: `DISPOSED`,
`DEFINITION_INVALID`, `BOUNDARY_REJECTED` (context / deps at the door), `SNAPSHOT_INCOMPATIBLE`,
`SNAPSHOT_NOT_SERIALIZABLE` (a `save()` of a non-JSON snapshot, §8), `NESTING_CYCLE`,
`NESTING_TOO_DEEP`, `UNKNOWN_EVENT`, `UNKNOWN_STEP` (`validate`), `NOT_A_FLOW_STEP` /
`NOT_ACTIVE` (`child`).

## 7. Events, `explain`, `inspect`

`observe()` and `log()` deliver `WizardEvent<F>`: an envelope `{ seq, at, path, causedBy? }` plus
the body — flow lifecycle (`flow.started/done/failed/compensating/compensated/cancelled/resumed`),
navigation (`transition.started/phase/committed/rejected/failed`), step lifecycle
(`step.arrived/entered/exited/done/failed/skipped/cancelled/validated/validationFailed/guardEvaluated`),
tasks (`step.runStarted/runSucceeded/runFailed/retryScheduled`), persistence (`persist.failed`), compensation
(`step.compensationStarted/compensated/compensationFailed`), data (`input.changed`,
`context.changed`), external events (`event.received/rejected/delivered/buffered/expired/dropped`),
timers (`timer.scheduled/fired/cleared`), nesting (`child.started/summary/command`), and
`command.rejected` / `result.ignored`. Child events arrive on the parent with their own `path`.

`WizardEvent<F>` is a union: `RootWizardEvent<F>` (the wizard's own events, `path: []`, ids
typed by the flow) | `ChildWizardEvent` (forwarded from a child, `path: [step, …]`, ids as
`string`). TypeScript does not narrow on `path.length`, so split them with `isChildEvent()`:

```ts
import { isChildEvent, type WizardEvent } from '@openwizard/core'

wizard.observe((event: WizardEvent<typeof checkout>) => {
  if (isChildEvent(event)) return // a child flow's event: event.path = ['fulfil', …], ids are strings
  if (event.type === 'step.done') event.step // 'shipping' | 'reserve' | … (typed)
})
```

(Inbox payloads, saga outputs and other `unknown` slots of `Snapshot<F>` are typed in a later
release.)

`wizard.explain(step)` → `Explanation<F> = { status, phase, reasons, candidates }` — `status`
is the stored step status (`'unknown'` for an unknown id), `phase` the live UI phase (`blocked |
ready | entering | validating | running | retrying | waiting | exiting | compensating`, or
`undefined`), `reasons` stable codes (`flow-not-started`, `flow-terminal`, `flow-compensating`,
`nav-busy`, `not-activated`, `deps-unmet:<id>`, `guard-false:canEnter|canExit`,
`concurrency-limit`, `auto-run-manual`, `failed:<kind>`, `not-current`, `entering`, `retrying`),
`candidates` the ready views the cursor could move to. Never throws.

`inspect(flow)` → `FlowGraph { name, version, nodes, edges, warnings }`: nodes `{ id, kind, path,
hooks, dependsOn?, timeout?, dynamicNext?, start? }` (`hooks` by their authoring names — a flow
step's `context` / `deps` / `output`, a final's `output`), edges `{ from, to, kind: 'next' |
'dependsOn' | 'timeout' | 'start', path }`, warnings `UNREACHABLE` / `NEVER_ACTIVATES` /
`NAV_CYCLE` (a cycle through `next` / `timeout.next` — allowed, reported) — recursively for
child flows. Runs no hook. This is what a visualizer or devtools panel consumes.

## 8. Persistence

```ts
import type { Store } from '@openwizard/core'
// interface Store { get(key): Promise<unknown | null>; set(key, snapshot): Promise<void>; delete(key): Promise<void> }
```

Give `createWizard` a `store` (and a tenant-scoped `key`): with `autoSave: 'change'` (the
default) a `Snapshot` is written after every committed change (`debounceMs` coalesces,
`redact` runs right before `store.set`, `save()` forces a write). `createMemoryStore()` (a
`MemoryStore`) does a JSON round trip on every write, like a real database.

**JSON-checked before every store write; resume re-validates.** Right before `store.set` the
value is walked: a `Map`, `Set`, `RegExp`, class instance, function, `bigint`, `NaN` /
`Infinity` or `undefined` array slot anywhere in it means the write does not happen —
`onPersistError` receives a `WizardError('SNAPSHOT_NOT_SERIALIZABLE')` naming the exact
location (`state.steps.save.output.createdAt`, also on `error.issues[0].path` and
`error.step`), a `persist.failed` event is logged, and `save()` rejects with it. The live
`getSnapshot()` is untouched; you fix the flow. Everything that must survive persistence has to
be a JSON value — with one deliberate exception: a `Date` (any object with `toJSON()`) is
accepted exactly where a schema / parse boundary re-parses its JSON form on resume — a task
`output`, a view `input`, the flow `context`, an event boundary (`z.coerce.date()` turns the
stored ISO string back into a `Date`; a `z.date()` there would make resume reject the snapshot
loudly, `SNAPSHOT_INCOMPATIBLE`, instead of quietly handing you a string). Anywhere else, or
under `boundary.trusted()` / `guard` / `assert`, store the JSON form (`toISOString()`) or keep
the value out of the state (`deps`). Secrets follow the same advice: never in `context` /
outputs — pass them through `deps`, store references and tokens.

**Persistence is single-owner in v0.1.** One live wizard per store key. `Store` is plain
`get / set / delete` — no compare-and-swap, lease or fencing — so two replicas resuming the
same snapshot at the same time would both run its side effects. Resume on another replica only
after the first instance is disposed (a crash, a drain, a hand-over you control). Snapshot
migration (`version` bumps with a converter) is planned for v0.2; until then a flow with a
different `name` / `version` rejects the snapshot (`SNAPSHOT_INCOMPATIBLE`).

```ts
import { resumeWizard, resumeWizardAsync } from '@openwizard/core'

const saved = await store.get(key) // unknown | null
const wizard = resumeWizard(checkout, saved, { deps, store, key })
wizard.epoch // 1 (incremented on every resume)
wizard.log()[0] // { type: 'flow.resumed', fromSeq, interrupted: [...] }
const other = await resumeWizardAsync(checkout, saved, { deps }) // flows with async boundaries
```

Resume validates the envelope (`v`, `flow.name` / `version`, `instanceId`, `seq`), the step
set, status invariants, JSON safety and **every boundary** (context, view outputs, task / flow
outputs and their copies on the compensation stack, event payloads in the inbox, nested
children) — otherwise `WizardError('SNAPSHOT_INCOMPATIBLE')` lists every reason. `resumeWizardAsync` awaits every boundary of the whole tree BEFORE anything is
instantiated (still atomic); the sync `resumeWizard` reports an asynchronous boundary as a reason
pointing to it. Then the recovery matrix applies:

| Persisted situation | On resume |
|---|---|
| navigation in flight (`nav.phase !== 'idle'`) | `transition.rejected { reason: 'resumed' }`; the cursor stays |
| task running | `step.failed { kind: 'interrupted' }` — `retry(step)` re-runs it (make side effects idempotent) |
| task with `retryAt` / wait with `deadline` / inbox TTLs | timers re-armed from their absolute times (fire immediately if overdue); the inbox is drained first |
| flow step active | child restored from `snapshot.children[step]` (re-created if missing) |
| `compensating` | continues unwinding from the stack |
| terminal (`done` / `failed` / `cancelled`) | restored read-only |

## 9. Projections and the wire door

Projections are deny-by-default: only what you list crosses the wire.

```ts
import { defineProjection, type ProjectionOutput } from '@openwizard/core'

const checkoutClient = defineProjection(checkout, {
  expose: {
    steps: {
      shipping: { input: true, issues: true }, // the draft and its validation issues
      reserve: { error: true }, //                 the sanitized error ({ name, message, code? })
    },
    context: ['total'], //                        picked context keys
    output: true, //                              the flow output (a final's `output`)
  },
})
type CheckoutClientState = ProjectionOutput<typeof checkoutClient> // ClientState<F, E>
const state = wizard.project(checkoutClient) // { status, current, context: { total }, output?, steps: { shipping: { input?, issues? } … } }
```

Per step `ExposeSpec` flags are `input` / `output` / `issues` / `error` and, on flow steps,
`child` (`true` = the compact `{ status, current, progress, seq }` summary; a nested spec = the
projected child state, deny-by-default inside, up to 8 child levels); `output: true` exposes the
flow output. `ClientState` carries per step only `{ id, kind, status, phase?, attempt }` plus
exactly what is exposed — the type mirrors the object (unexposed = absent, not optional).
`SerializedError` never carries a stack. `Projection` (with the extractors `ProjectionFlow`,
`ProjectionOutput`, and `AnyProjection`; per-step flags are `StepExpose`, the whole spec
`ExposeSpec`) is data a client can import type-only; it keeps a reference to its flow object,
and `wizard.project()` / `createMirrorSource()` accept it for that flow object only
(`DEFINITION_INVALID` for another flow, even a same-name, same-shape one).

The one door for commands from a transport is `dispatch(command)`, typed by the flow
(`Command<F>`: `go` / `setInput` / `resetInput` take a `ViewId` — and `setInput.patch` is that
view's `DraftOf` —, `run` / `retry` a `TaskId`, `send` a declared event, `child.path` flow
steps with the nested command typed by the child flow). Untrusted request bodies become a
`Command<F>` through `parseCommand(flow, unknown)`: exact per-type field allow-lists, JSON-only
payloads, child path depth ≤ 8, and every id checked against the flow (unknown → issues):

```ts
import { type Command, parseCommand } from '@openwizard/core'

const decoded = parseCommand(checkout, request.body) // { ok: true, value: Command<typeof checkout> } | { ok: false, issues }
if (decoded.ok) await wizard.dispatch(decoded.value) // after YOUR authorization — no cast
// Command<F> = start | next | back | go | setInput | resetInput | send | run | runReady | retry
//            | cancel | compensate | reset | child { path: [flowStep, …], command }
```

The client half is in core too. `createMirrorSource(wizard, projection)` on the server publishes
one `Frame` per commit and answers `WireCommand`s with `WireAck`s (decoded with
`parseWireCommand`, gated by `instanceId` / `expectedSeq`; dispatches are serialized so the seq
check and the enqueue are one step; hostile input — 20 000-deep payloads, `__proto__` keys,
64 KiB+ strings — is an `INVALID_COMMAND` value, never a rejection). `createMirror({ transport })`
on the client is a read-only replica with the same typed command sugar as `Wizard`
(`start` … `reset`, `send(event, payload, { correlationId })`), applying frames through
`parseFrame` (malformed frames are ignored, a retired instance id never comes back), and
rejecting an ack that is not for the command it sent. A `Transport<S>` is the one interface a
host implements (SSE + POST, WebSocket, postMessage); `createLocalTransport` (in
`@openwizard/core/testing`) is the in-process loopback. The React hooks live in
[`@openwizard/react`](../react/README.md).

## 10. Testing with `@openwizard/core/testing`

The `@openwizard/core/testing` entry holds the helpers that must not ship in an application
bundle: `createTestScheduler` and `createLocalTransport` (with `TestScheduler` /
`LocalTransportOptions`). The runtime never calls `Date.now()` or `setTimeout` directly: it uses
the injectable `clock` / `scheduler`. `createTestScheduler({ now? })` returns a `TestScheduler`
(both at once) so a test drives retries, wait timeouts and inbox TTLs deterministically:

```ts
import { createWizard } from '@openwizard/core'
import { createTestScheduler } from '@openwizard/core/testing'

const sched = createTestScheduler({ now: 1_000 })
const wizard = createWizard(checkout, { context, deps, scheduler: sched }) // sched is the clock too
await wizard.start()
sched.pending() // armed timers
sched.advance(200) // fires every timer due within 200 ms, in order, synchronously
sched.flush() // fires everything that is left
```

Timers fire synchronously inside `advance()`, so the resulting state is committed when it
returns; async hooks (real promises) still need a microtask tick (`await new Promise((r) =>
setTimeout(r, 0))`). Pass in-memory fakes as `deps` and assert on `log()` / `observe()` — see
every [example](../../examples). To test a Mirror end to end without a network:

```ts
import { createMirror, createMirrorSource } from '@openwizard/core'
import { createLocalTransport } from '@openwizard/core/testing'

const source = createMirrorSource(wizard, checkoutClient)
const mirror = createMirror<typeof checkoutClient>({
  transport: createLocalTransport(source, { serialize: true }), // JSON round trip, like a wire
})
```

## 11. Guarantees

- **Sync-commit.** For a public call made from outside a drain, if every hook it triggers returns a non-thenable, the resulting state is committed and listeners are notified **before the call returns**, and the returned promise is already settled. `strict: 'sync'` turns the first thenable into a `SYNC_VIOLATION` failure.
- **Batch atomicity.** Every message (command, hook result, timer, child result) goes through one FIFO queue and is processed as `decide → apply → plan → commit`. Listeners and persistence never observe intermediate states; state listeners run once per committed batch; effects run only after the commit. Stale results (a retry that raced a cancel) are `result.ignored`.
- **Boundaries are the only doors.** Data enters through `context`, `setInput` (parsed on `next` / `go`), `send`, or `resume` — each through a declared boundary, exactly once (a child's context / deps mappers included). Nothing else can put a value in the state; `boundary.trusted<T>()` is the grep-able exception.
- **Results as values.** Data problems (validation, guards, busy navigation, terminal flows, dropped events, incompatible payloads) are `{ ok: false, code, … }` results and events; `WizardError` is reserved for programmer errors.
- **Snapshots are JSON-checked before every store write; resume re-validates.** A write that `JSON.stringify` would distort does not happen (`SNAPSHOT_NOT_SERIALIZABLE` + `persist.failed`, with the path); `Date`s survive only under a reviving boundary; `SerializedError` is `{ name, message, code? }`. Everything is re-validated on resume.
- **Public surface hygiene.** No `any` and no type assertions in the emitted declarations (`api/core.d.ts` is diffed in CI); every export is documented and listed below.

## Exports

<!-- exports:start -->

<!-- generated by scripts/gen-export-tables.mjs — do not edit by hand -->

### `@openwizard/core`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `AnyFlow` | type | Any flow — the constraint of every extractor and of `Wizard<F>`; `any`-free (a flow's | [src](../../packages/core/src/authoring/types.ts#L630) |
| `AnyProjection` | type | Any projection (the constraint of `ProjectionOutput`). | [src](../../packages/core/src/projection/define-projection.ts#L155) |
| `boundary` | const | Build a branded `Checker` from a plain function: `parse` (returns the value or throws), | [src](../../packages/core/src/authoring/boundary.ts#L41) |
| `Boundary` | type | A data door: any Standard Schema (Zod 4 / Valibot / ArkType / …) or a branded `Checker`. | [src](../../packages/core/src/authoring/types.ts#L141) |
| `Checker` | interface | A branded runtime checker built by `boundary.parse/guard/assert/trusted`. `I` is the | [src](../../packages/core/src/authoring/types.ts#L131) |
| `ChildCommand` | type | A command addressed to a nested flow: `path: [flowStep]` with a `Command` of that child, or a | [src](../../packages/core/src/wizard/create-wizard.ts#L185) |
| `ChildFlowOf` | type | Child flow of a `flow` step (`never` for other kinds). | [src](../../packages/core/src/authoring/types.ts#L729) |
| `ChildStepId` | type | Ids of the `flow` steps (`child()` accepts these). | [src](../../packages/core/src/authoring/types.ts#L766) |
| `ChildSummary` | type | Compact status of a child flow as stored on the parent's flow step (`status`, `current`, | [src](../../packages/core/src/projection/define-projection.ts#L47) |
| `ChildWizardEvent` | type | A domain event forwarded from a child flow (`path.length > 0`, the child's wizard path): step | [src](../../packages/core/src/wizard/create-wizard.ts#L124) |
| `ClientState` | type | The projected (client-safe) state of a wizard for exposure spec `E`. `Depth` counts the child | [src](../../packages/core/src/projection/define-projection.ts#L124) |
| `ClientStepState` | type | Projected state of one step: base facts (`id`, `kind`, `status`, `phase`, `attempt`) plus | [src](../../packages/core/src/projection/define-projection.ts#L102) |
| `Clock` | interface | Wall clock the runtime reads for timestamps and timer deadlines (`createWizard({ clock })`). | [src](../../packages/core/src/interpreter/env.ts#L17) |
| `Command` | type | A wire command (JSON), typed by the flow: `go` / `setInput` / `resetInput` take a `ViewId<F>` | [src](../../packages/core/src/wizard/create-wizard.ts#L219) |
| `CommandResult` | type | Result of `dispatch()` and of every non-navigation command method (`start`, `setInput`, `retry`, …). | [src](../../packages/core/src/wizard/results.ts#L19) |
| `ContextInput` | type | Context input type of a flow (boundary INPUT side — what `createWizard` accepts). | [src](../../packages/core/src/authoring/types.ts#L676) |
| `createMemoryStore` | function | In-memory `Store` (JSON round-trip on every `set`/`get`) for tests, examples and single-process use. | [src](../../packages/core/src/persistence/memory-store.ts#L27) |
| `createMirror` | function | Create a Mirror over `transport`. Subscribes immediately; the server sends the current frame | [src](../../packages/core/src/mirror/create-mirror.ts#L96) |
| `createMirrorSource` | function | Create the server half of a Mirror for `wizard` seen through `projection` (which must be | [src](../../packages/core/src/mirror/source.ts#L56) |
| `createWizard` | function | Create a wizard from a flow: parses `context` (and `deps`) through the flow's boundaries | [src](../../packages/core/src/wizard/create-wizard.ts#L373) |
| `createWizardAsync` | function | Like `createWizard`, for flows whose context / deps boundaries are asynchronous. | [src](../../packages/core/src/wizard/create-wizard.ts#L390) |
| `Ctx` | type | Parsed context type of a flow (boundary OUTPUT side). | [src](../../packages/core/src/authoring/types.ts#L671) |
| `defineFlow` | function | Start a flow definition: `const s = defineFlow({ name, context, events?, deps?, …policies })`, | [src](../../packages/core/src/authoring/define-flow.ts#L67) |
| `defineProjection` | function | Define a deny-by-default projection of a flow: only the listed step inputs / outputs / issues / | [src](../../packages/core/src/projection/define-projection.ts#L184) |
| `DepsOf` | type | Deps type of a flow (`unknown` when the flow declares no `deps` boundary). | [src](../../packages/core/src/authoring/types.ts#L681) |
| `DraftOf` | type | Draft patch type of a view (`Partial` of the INPUT side) — what `setInput` accepts. | [src](../../packages/core/src/authoring/types.ts#L718) |
| `Duration` | type | A duration: milliseconds as a number, or a string with a unit (`'250ms'`, `'15m'`, `'2h'`, `'1d'`). | [src](../../packages/core/src/authoring/types.ts#L54) |
| `EventType` | type | Declared event names of a flow. | [src](../../packages/core/src/authoring/types.ts#L691) |
| `Explanation` | type | Result of `wizard.explain(step)`: the step's stored `status` (`'unknown'` for an unknown id), | [src](../../packages/core/src/wizard/create-wizard.ts#L152) |
| `ExposeSpec` | interface | What a projection exposes: per-step flags, the context keys that cross the wire, and whether | [src](../../packages/core/src/projection/define-projection.ts#L69) |
| `Flow` | interface | A defined flow. `T` is the COMPACT steps map (`{ [id]: FlowStep<…> }`); the runtime object | [src](../../packages/core/src/authoring/types.ts#L605) |
| `FlowBuilder` | interface | What `defineFlow(options)` returns: the pre-bound constructors plus `steps()`. | [src](../../packages/core/src/authoring/types.ts#L652) |
| `FlowGraph` | interface | The static graph of a flow: nodes, edges and analysis warnings (recursively for child flows). | [src](../../packages/core/src/inspect/graph.ts#L52) |
| `FlowOutput` | type | Output type of a flow: the union of its `final` steps' outputs. | [src](../../packages/core/src/authoring/types.ts#L773) |
| `FlowStep` | interface | What `Flow.steps[k]` is typed as: the per-step facts only (kind + phantom). `C`/`Ev`/`D` are | [src](../../packages/core/src/authoring/types.ts#L373) |
| `FlowWarning` | interface | A static-analysis warning about a flow (advisory; never thrown). | [src](../../packages/core/src/authoring/compile.ts#L52) |
| `Frame` | interface | Server → client: one full projected snapshot (`state`) of instance `instanceId`, tagged with | [src](../../packages/core/src/mirror/wire.ts#L34) |
| `InputOf` | type | Raw input (draft, INPUT side of the view's `input` boundary) type of a step; `never` without a draft. | [src](../../packages/core/src/authoring/types.ts#L713) |
| `inspect` | function | Build the static graph of a flow (compiles it if needed; throws `DEFINITION_INVALID` for a | [src](../../packages/core/src/inspect/graph.ts#L65) |
| `isChildEvent` | function | True for events forwarded from a child flow (`event.path.length > 0`); narrows a | [src](../../packages/core/src/wizard/create-wizard.ts#L140) |
| `Issue` | type | A validation problem (Standard Schema issue shape): a message and an optional path. | [src](../../packages/core/src/authoring/types.ts#L69) |
| `isWizardError` | function | Type guard for `WizardError`. | [src](../../packages/core/src/errors.ts#L75) |
| `MemoryStore` | interface | What `createMemoryStore()` returns: a `Store` plus `keys()` / `clear()` for tests and diagnostics. | [src](../../packages/core/src/persistence/memory-store.ts#L16) |
| `Mirror` | interface | Client-side replica of a wizard through projection `P`: read the projected state | [src](../../packages/core/src/mirror/create-mirror.ts#L53) |
| `MirrorOptions` | interface | `createMirror` options: the `transport` (typed by the projected state), an optional id | [src](../../packages/core/src/mirror/create-mirror.ts#L39) |
| `MirrorSource` | interface | Server half of a Mirror: frames out, wire commands in. `S` is the projected state type | [src](../../packages/core/src/mirror/source.ts#L34) |
| `NavResult` | type | Result of the navigation methods `next()`, `back()` and `go()`. | [src](../../packages/core/src/wizard/results.ts#L34) |
| `OutputOf` | type | Output type of a step: parsed input (view), run result (task), `{ event, payload }` (wait), | [src](../../packages/core/src/authoring/types.ts#L724) |
| `parseCommand` | function | Strictly decode an untrusted wire value into a `Command<F>` of `flow`: exact per-type field | [src](../../packages/core/src/wizard/parse-command.ts#L66) |
| `parseFrame` | function | Strictly check an untrusted value as a `Frame` envelope: exact property allow-list, | [src](../../packages/core/src/mirror/wire.ts#L149) |
| `parseWireCommand` | function | Strictly decode an untrusted value into a `WireCommand<F>` for `flow`: exact property | [src](../../packages/core/src/mirror/wire.ts#L80) |
| `PayloadOf` | type | Parsed payload type of one event. | [src](../../packages/core/src/authoring/types.ts#L696) |
| `Projection` | interface | A projection: the `Flow` object it belongs to (compared by identity), its exposure spec, and | [src](../../packages/core/src/projection/define-projection.ts#L144) |
| `ProjectionFlow` | type | The flow type a projection was defined for. | [src](../../packages/core/src/projection/define-projection.ts#L161) |
| `ProjectionOutput` | type | The projected state type of a projection (`ClientState` of its flow for its exposure spec). | [src](../../packages/core/src/projection/define-projection.ts#L173) |
| `ResumeOptions` | type | `resumeWizard` options (`WizardOptions` without `context` / `instanceId`, which come from the snapshot). | [src](../../packages/core/src/wizard/create-wizard.ts#L361) |
| `resumeWizard` | function | Resume a wizard from a persisted snapshot: the envelope, flow identity, step set and every | [src](../../packages/core/src/wizard/create-wizard.ts#L413) |
| `resumeWizardAsync` | function | Like `resumeWizard`, for flows with asynchronous boundaries (context, deps, view inputs, task | [src](../../packages/core/src/wizard/create-wizard.ts#L433) |
| `RetryPolicy` | type | Retry policy for tasks (plain data, so `inspect()` shows it; the retry STATE — `attempt`, the | [src](../../packages/core/src/authoring/types.ts#L103) |
| `RootWizardEvent` | type | A domain event of the wizard's OWN flow (`path` is `[]`), typed by the flow: `step` is a | [src](../../packages/core/src/wizard/create-wizard.ts#L114) |
| `Scheduler` | interface | Timer scheduler the runtime arms retries, wait timeouts and inbox TTLs with | [src](../../packages/core/src/interpreter/env.ts#L28) |
| `SendResult` | type | Result of `send(event, payload)`: delivered/buffered, rejected by the event boundary | [src](../../packages/core/src/wizard/results.ts#L67) |
| `SerializedError` | type | A serializable error (`name`, `message`, optional `code`) — never carries a stack. | [src](../../packages/core/src/authoring/types.ts#L75) |
| `SetInputCommand` | type | `setInput` correlated per view: `step: K` with `patch: DraftOf<F, K>`. | [src](../../packages/core/src/wizard/create-wizard.ts#L174) |
| `Snapshot` | interface | The versioned, JSON-safe snapshot of a wizard (what `getSnapshot()` returns, what a `Store` | [src](../../packages/core/src/wizard/create-wizard.ts#L86) |
| `Step` | interface | One step as returned by a constructor. `C` context, `Ev` event map, `D` deps, `I` raw input | [src](../../packages/core/src/authoring/types.ts#L329) |
| `StepApi` | interface | Constructors pre-bound to `C`/`Ev`/`D`. Only `N` captures literals; no `const` params. | [src](../../packages/core/src/authoring/types.ts#L489) |
| `StepExpose` | type | Exposure of one step: its draft `input`, its `output`, its validation `issues`, its sanitized | [src](../../packages/core/src/projection/define-projection.ts#L55) |
| `StepId` | type | Step ids of a flow. | [src](../../packages/core/src/authoring/types.ts#L701) |
| `StepKind` | type | The six step kinds: `view \| task \| wait \| decision \| flow \| final`. | [src](../../packages/core/src/authoring/types.ts#L81) |
| `StepState` | type | Typed view of one step's stored record: `input` is the draft (`DraftOf`), `output` the | [src](../../packages/core/src/wizard/create-wizard.ts#L56) |
| `StepStatus` | type | Stored status of a step: `idle \| active \| done \| failed \| skipped \| cancelled \| compensating \| compensated`. | [src](../../packages/core/src/authoring/types.ts#L87) |
| `Store` | interface | Store — the persistence port. One snapshot per key; the value is whatever | [src](../../packages/core/src/persistence/store.ts#L15) |
| `TaskId` | type | Ids of the task steps (`retry`, `run` accept these). | [src](../../packages/core/src/authoring/types.ts#L759) |
| `Transport` | interface | Client-side transport of the wire protocol: `subscribe` delivers frames (the server sends the | [src](../../packages/core/src/mirror/transport.ts#L17) |
| `ViewId` | type | Ids of the view steps (`go`, `setInput`, `resetInput`, `validate` accept these). | [src](../../packages/core/src/authoring/types.ts#L752) |
| `WaitOutput` | type | Output of a wait step: the resolving `{ event, payload }` (union over every flow event), | [src](../../packages/core/src/authoring/types.ts#L285) |
| `WireAck` | interface | Server → client: the `CommandResult` of the command `commandId`, plus the instance `seq` | [src](../../packages/core/src/mirror/wire.ts#L61) |
| `WireCommand` | interface | Client → server: a wire `Command` (JSON, decoded with `parseCommand` on the server) addressed | [src](../../packages/core/src/mirror/wire.ts#L49) |
| `Wizard` | interface | A live wizard instance, typed by its flow. Navigation returns `NavResult`, everything else a | [src](../../packages/core/src/wizard/create-wizard.ts#L249) |
| `WizardError` | class | Error thrown for programmer errors (misuse of the API): unknown event names, | [src](../../packages/core/src/errors.ts#L52) |
| `WizardErrorCode` | type | Stable error codes carried by `WizardError` and by `{ ok: false }` results. | [src](../../packages/core/src/errors.ts#L20) |
| `WizardEvent` | type | A domain event of a wizard (`observe()` / `log()`): either an event of its own flow, typed by | [src](../../packages/core/src/wizard/create-wizard.ts#L133) |
| `WizardOptions` | type | `createWizard` options: the context input (parsed by the flow's context boundary), `deps` | [src](../../packages/core/src/wizard/create-wizard.ts#L329) |
| `WizardStatus` | type | Status of a wizard instance: `idle \| running \| waiting \| done \| failed \| compensating \| cancelled`. | [src](../../packages/core/src/authoring/types.ts#L93) |

### `@openwizard/core/testing`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `createLocalTransport` | function | Loopback transport over a `MirrorSource` (same process, no wire). With the defaults, frames | [src](../../packages/core/src/mirror/local-transport.ts#L35) |
| `createTestScheduler` | function | Deterministic scheduler + clock for tests: `createWizard(flow, { scheduler })` (it doubles as | [src](../../packages/core/src/interpreter/test-scheduler.ts#L40) |
| `LocalTransportOptions` | interface | `createLocalTransport` options: `delayMs` delays every frame and every command/ack hop | [src](../../packages/core/src/mirror/local-transport.ts#L24) |
| `TestScheduler` | interface | Virtual-time scheduler + clock for tests (what `createTestScheduler()` returns): `advance(ms)` | [src](../../packages/core/src/interpreter/test-scheduler.ts#L17) |

<!-- exports:end -->

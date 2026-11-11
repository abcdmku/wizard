# OpenWizard architecture and implementation plan

This document records the current implementation contracts. The original v0.1 and v0.2 planning is in Git history; the ADRs retain the decisions and alternatives. [Machine specification](machine-spec.md) defines execution rules. [ADR-001](adr/ADR-001-type-strategy.md) defines the authoring type strategy.

## Context and lessons

OpenWizard coordinates synchronous and asynchronous workflows through typed definitions and observable runs. Views, data joins, event waits, parallel work, compensation, and child workflows share one execution model. A client can subscribe to a safe projection of server-owned state.

Earlier attempts established several constraints:

- v1 had useful deep inference and UI ideas, but a large mutable runtime closure made state ownership and async guards hard to inspect.
- Typed fields without runtime consumers created promises the engine could not keep.
- Restoring context on back navigation hid business changes. Draft retention and explicit updates are easier to reason about.
- A type-test file proves nothing unless CI actually typechecks it.
- Generated exports, declaration snapshots, and checked examples must move with the implementation.

The v1 implementation at `abd8862` and draft at `06159e2` remain historical references. They are not current API specifications.

## Design constraints

1. Use one authoring path, `defineWizard`, and one live run type, `Run`.
2. Keep step constructors as object configurations. Each field must have a runtime consumer.
3. Capture inference at construction and validate references at `steps(map)` assembly. A bad reference must not erase unrelated step types.
4. Keep one extractor for each concept and avoid positional generics in application code.
5. Keep files below roughly 400 lines and split responsibilities before adding another execution path.
6. Test user behavior and type contracts. Avoid tests that duplicate implementation details.
7. Share runtime identity across package entries, especially errors and boundary brands.

## 1. Core architecture

### 1.1 Pure machine and interpreter

The machine has three operations:

```ts
decide(env, state, message) // Decision { events, state, at }
apply(env, state, event)   // state after one recorded event
plan(env, state, events)   // effect descriptions for the post-batch state
```

`decide` returns the batch and its folded state. The interpreter adopts that state; it does not fold the same batch again. `apply` remains the event fold for replay and deterministic machine tests. Neither operation invokes user hooks, starts timers, or accesses a store.

One interpreter per run owns a message queue. Hook results re-enter it as messages. It processes synchronous results before the next planned call, so a later sibling hook sees prior committed updates. Async results carry tokens that identify their step activation, attempt, or navigation transaction; obsolete results cannot change current work.

The public state is the last committed view. A durable barrier receives staged state and child snapshots; public readers and listeners do not observe that state until its write succeeds. If the barrier fails, the interpreter stops and aborts work that has not started.

A child interpreter defers hook execution while an ancestor is processing messages. A queued parent cancellation can therefore stop child work before its hook begins.

### 1.2 Structural kinds and behavior

There is no mode switch. The structural kinds are `step`, `view`, and `flow`.

| Definition | Completion |
|---|---|
| `step({ run })` | Runnable hook returns, with optional output validation |
| `step({ each, run })` | All snapshotted items return; output is an ordered array |
| `step({ waitFor })` | Event handler completes the wait or its timeout fires |
| `step({ sleep })` | Persisted absolute deadline is due |
| `step({ next, targets? })` | Routing or join work completes with `undefined` output |
| `view({ input, ... })` | Forward navigation parses and validates the draft |
| `flow(childWizard, ...)` | Child finishes, with optional output mapping |
| `flow(childWizard, { each, ... })` | Per-item children finish; output is an ordered array |

Policies such as retry, concurrency, `when`, fallback, and compensation modify those behaviors. A configuration that mixes incompatible work fields, such as `run` and `waitFor`, is invalid.

### 1.3 Activation and data

`next` pushes activation to its targets. An array starts several branches. Dynamic `next` requires declared `targets`, and both types and runtime enforce membership.

`dependsOn` is a control gate. All or any of its producers must be done or skipped, but the gate does not activate the consumer and supplies no hook data.

`needs` is a typed data join and an activation edge. A plain reference waits for its output; `{ any: [...] }` uses the first completed producer; `{ optional: producer }` waits for settlement and returns output or `undefined`. Every hook receives the resolved `needs` values.

A skipped required producer skips its consumer with `needs-skipped`. An any-need skips only if every candidate skips. Optional needs do not propagate skips.

Unchosen declared targets become `not-taken`. Static descendants skip when all their predecessors skipped. A quiescent join with unreachable requirements fails with `DEPS_UNREACHABLE`; it must not park indefinitely.

### 1.4 Output and recovery edges

Without a definition-level `output` selector, the run returns the last completed sink's output. A sink has no normal successor and no consumer of its output. Fallback and event-timeout edges are alternate paths and do not remove its successful-path sink role.

Several sinks or no static sink produce an inspection warning. Inference includes `undefined` when a sink can be skipped or no sink can supply a result. An options-level `output: ({ context }) => ...` defines a stable result independently of branch completion order.

### 1.5 Stored and derived state

Snapshots are authoritative. The event log is a bounded diagnostic trace, not the resume source.

Store step statuses, context, drafts, outputs, item records, deadlines, event buffers and ids, compensation entries, and child snapshots. Derive readiness, live phase, available views, explanations, and progress summaries from those facts. Queries never invoke hooks.

`halted` is recoverable; `failed`, `done`, and `cancelled` are terminal. A failure under the default policy halts scheduling without discarding completed work. Compensation ends the path after unwinding completed effects.

## 2. Authoring and runs

```ts
const checkout = defineWizard(
  { name: 'checkout', context: CheckoutContext },
  ({ step, view, steps }) => steps({
    address: view({ input: Address, next: 'reserve' }),
    reserve: step({ run: ({ context }) => reserve(context), next: 'receipt' }),
    receipt: step({ run: ({ context }) => ({ orderId: context.orderId }) }),
  }, { start: 'address' }),
)

const run = checkout.create(input)
const graph = inspect(checkout)
```

A `Wizard` is the flow definition plus bound `create`, `createAsync`, `resume`, `resumeAsync`, `run`, `runSync`, and `provide` methods. Pass it directly to inspectors, child constructors, projections, durable hosts, HTTP adapters, and React bindings. A `Run` refers to that definition through `run.flow`.

`provide(deps)` returns a new wizard. `DepsOf` describes all services hooks see; `RequiredDepsOf` describes those still needed at creation. Provided services follow the definition into every run creator, including children and durable hosts.

The live run exposes typed commands and queries. Manual runnable execution uses `startStep` and `startReady`, including over the wire. Navigation commands can carry `from` for an atomic step-scoped check.

`awaitOutcome` reports the next terminal, halted, or externally waiting state without disposing the run. `awaitResult` waits for terminal state. `wizard.run` creates, starts, awaits the outcome, and disposes. Sleeps and retry delays keep it running. `runSync` throws `SYNC_VIOLATION` when completion requires async work.

## 3. Boundaries and inference

Context, view input, event payloads, outputs, dependencies, and snapshots enter through their boundaries. Standard Schema input and output types stay distinct. `send` checks typed payload inputs while permitting an `unknown` body for runtime validation.

Constructors capture only facts a step actually has. Assembly checks ids and step-object references against the real map. It rejects orphan references, duplicate object placements, incompatible bindings, empty definitions and lists, invalid option combinations, and dependency cycles.

Object identity cannot always be proved from structural TypeScript types. Runtime assembly checks remain necessary. Reusable module parameters preserve the step's inferred type with generics. [ADR-001](adr/ADR-001-type-strategy.md) documents the error-location and performance tradeoffs.

Type tests compile against source entries. A deliberate canary verifies that the test runner reports real type failures. Declaration snapshots test what package consumers see.

## 4. Persistence and distributed hosting

Core sequences single-process snapshot writes. It supplies neither cross-process ownership nor a transaction around remote effects.

`@openwizard/durable` owns leases, fenced compare-and-swap commits, takeover, renewal, command result replay, and timer claims. Its barrier commits staged state before new effects. Completed command results commit with their associated state; unresolved applied navigation commands remain interrupted rather than being executed again.

Execution against an external service remains at least once for idempotent interrupted work. Runnable and compensation hooks receive stable idempotency keys; the service must enforce them.

On resume, a run processes its overdue timers before its own interrupted work. The parent resumes before children restore. Stored child snapshots must remain present in the resume barrier even before their local interpreters exist.

Storage adapters implement `@openwizard/durable/store` and run the `@openwizard/durable/testing` conformance suite. Database resources, secrets, and migrations remain application responsibilities.

## 5. Clients and integrations

Projections are deny-by-default through `expose`, or explicitly mapped through `select`. Scoped selectors receive an authenticated principal that never enters durable or wire data. Source authorization checks each parsed command before dispatch.

Mirror APIs live in `@openwizard/core/mirror`. Snapshot frames are versioned by instance, epoch, and sequence. Transient progress frames have a separate kind, reach `mirror.observe`, and require per-step opt-in. Select projections use `progress: { work: true, nested: { child: { upload: true } } }`.

`@openwizard/http` provides framework-neutral request handling, signed ingress, outbound event subscriptions, and OpenAPI. Access is deny-by-default. Its client entry supplies HTTP/SSE transport; its Nitro entry adapts artifact hosting.

React binds to `typeof wizard` or a projection. `useRun(() => wizard.create(input))` owns the source across StrictMode; mirror bindings expose connection state. Effects use `runEffect` as a run adapter with `EffectDeps`, preserving success and failure inference.

Inspection lives in `@openwizard/core/inspect`; deterministic test tools live in `@openwizard/core/testing`. Public entries share runtime identity.

## 6. Implementation and verification

The original sequence started with the type spike, then the engine, parallel scheduling, clients, and release checks. Refinement keeps that dependency order: agree on authoring facts and compiled contracts before changing execution or consumers.

| Area | Responsibility | Evidence |
|---|---|---|
| Authoring | Bound constructors, assembly, boundaries, compiled graph | Inference, error locations, runtime invalid definitions |
| Machine | Navigation, readiness, events, retry, compensation | Literal state and event outcomes |
| Interpreter | Queue, barriers, tokens, timers, children | Commit visibility, aborted unstarted calls, sync/async behavior |
| Runtime | Typed commands, outcomes, snapshots, disposal | Public lifecycle and recovery scenarios |
| Projection and mirror | Data selection, authorization, wire protocol | Serialized non-disclosure and version ordering |
| Durable and adapters | Ownership, commits, claims, transport | Store conformance and crash-boundary regressions |
| Docs and examples | Canonical usage and pattern explanations | Source-backed snippets and checked imports |

Use focused source-resolving tests during parallel work. The integration gate runs build, typecheck, lint, tests, examples, declaration checks, docs checks, package checks, and size budgets. A passing gate verifies the current tree; historical planned budgets and milestone labels do not override package configuration.

Generated README export tables and `api/*.d.ts` snapshots move with the exported API. Every public generic contract needs type coverage, and every documented behavior needs a focused regression or executable example.

Exactly-once remote effects, a visual workflow editor, infrastructure provisioning, and domain-specific authorization remain outside core.

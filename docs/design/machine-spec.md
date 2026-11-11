# Machine specification

This document is normative for `packages/core/src/machine/**`. [Architecture plan](architecture-plan.md) explains the design; [ADR-001](adr/ADR-001-type-strategy.md) explains authoring inference. The command, state, event, effect, and compiled-flow types are the implementation contracts.

`env` contains the compiled definition, clock, ids, randomness, and event-id retention. Machine functions describe work; the interpreter executes it.

## 0. Global rules

- `decide(env, state, message)` returns `Decision { events, state, at }`. Its state equals the fold of its events. The interpreter adopts it once.
- `apply(env, state, event)` folds recorded facts. `plan(env, postBatchState, events)` returns effect descriptions.
- Invalid commands return rejection events and result values. Unknown references at definition assembly are `DEFINITION_INVALID`.
- Terminal states are `done`, `failed`, and `cancelled`. `halted` is recoverable.
- Commands after disposal resolve `DISPOSED` results. Later subscriptions and observers are inert.
- Hook calls carry activation, attempt, and transaction tokens. Cancelled or obsolete calls do not invoke hooks or apply late results.
- Public state, events, and listener notifications describe committed batches. A persistence barrier can inspect staged state and child snapshots before publication.

## 1. Navigation

A navigation transaction has an id, source, targets, cause, and phase. Another navigation command while it is open is rejected as busy. Draft edits, events, and recovery commands still obey their own gates.

| Command | Behavior |
|---|---|
| `start` | Activate every declared start step and schedule eligible work |
| `next` | Leave the current view through forward validation |
| `go` | Navigate to an eligible or previously visited view |
| `back` | Return to the previous view while keeping drafts |
| `next/back` with `from` | Verify the current view atomically before navigation |

Forward navigation parses the draft, runs `validate`, checks `canExit`, resolves targets, checks `canEnter`, runs source `exit`, initializes target drafts, then runs target `enter`. A rejection keeps the source current. Earlier initializer results can remain stored if a sibling target fails.

Back navigation skips input parsing, validation, `canExit`, and the source's `exit`. Internal events can retain direction metadata; direction is not a public exit-hook argument.

A dynamic `next` requires declared `targets`. Resolve string and step-object references against the assembled map. A throwing selector, unknown result, or result outside those targets fails the source step under the configured policy. It must not complete the run successfully.

Cancelling during navigation closes the transaction. An aborted guard is not a negative business verdict and must not be recorded as one.

## 2. Step entry and completion

Entry creates a new step activation, clears stale execution fields, and preserves a view's retained draft. A dynamic initializer runs only when no draft exists. Its result enters state before the view's `enter` hook reads it.

| Shape | Work after `enter` |
|---|---|
| View | Wait for navigation and input |
| Runnable step | Invoke `run`, validate optional output, record result |
| Item step | Snapshot `each` source, start items within its limit |
| Event wait | Drain matching buffered events, arm timeout |
| Sleep | Record and arm an absolute deadline |
| Routing/join step | Complete with `undefined`, then resolve `next` |
| Child flow | Map child input/deps, create child, wait for outcome |
| Per-item child flow | Create one child per snapshotted item |

Successful completion activates normal successors and data consumers. A sink can finish without an explicit final node. The run completes when work has settled and no active or still-reachable work remains.

Default output is the output of the last completed sink. A sink has no normal successor and no consumer of its output. Fallback and event-timeout edges are alternate paths, so they do not remove the successful-path sink role. A definition-level output selector overrides sink selection.

## 3. Activation, readiness, and skips

Activation and gating are distinct.

- `start` and `next` push activation.
- `needs` gates a consumer and supplies typed outputs to every hook. Producer settlement also activates the consumer, with one exception.
- A declared target of a function `next` is routed. Only that choice, or another push edge, activates it. Its needs gate it and never activate it, so a target that was not chosen stays `not-taken` when its producers finish, before or after the choice.
- `when` runs once the candidate is eligible. False skips it before entry.
- The concurrency budget delays runnable work. Views and event waits do not consume runnable slots.
- `autoRun: 'manual'` leaves ready work for `startStep` or `startReady`.

| Need mode | Satisfaction | Skip propagation |
|---|---|---|
| Plain ref | Producer done | A skipped producer skips the consumer |
| `any` | First producer done, preserving that selected output | All producers skipped skips the consumer |
| `optional` | Producer settled | No propagation; missing output is `undefined` |

Non-chosen declared targets skip with reason `not-taken`. Static descendants skip when every static predecessor skipped. A descendant with needs is exempt and decides from its needs, unless it is routed: a routed step skips with `not-taken` once every step that could push to it has skipped. Required data-need skips use `needs-skipped`. A later producer output can revive a `needs-skipped` consumer that is not routed. It never revives a `not-taken` one. Skips do not invoke the step's `exit` and do count toward completion summaries.

When a quiescent join cannot satisfy a dependency that can no longer activate, fail it with `DEPS_UNREACHABLE`, naming the dependency and excluding router when known. Inspection warns about plain needs over mutually exclusive targets.

## 4. Runnable work, retry, and item state

A successful runnable result becomes step output after boundary validation. A failure can pass through `mapError`; the returned data must be JSON-safe and determines `retry.when` when configured.

`retry.retries` is the number of extra runs after the initial call. Backoff is fixed milliseconds or exponential with `baseMs`, `factor`, and `maxBackoffMs`. `jitter` is bounded from zero to one. Draw and store the absolute retry deadline once; replay and resume do not draw it again.

An explicit `retry(step, { patch })` applies its context patch before starting the new attempt. Preserve the stored idempotency key for the activation.

For `each`:

1. Evaluate and snapshot the source array once when the step starts.
2. Assign input indexes and optional unique keys. Reject a non-array source or duplicate keys.
3. Run at most the configured item concurrency.
4. Record each completed item result by input position.
5. Apply retry per item. A permanently failed item fails the step without deleting finished results.
6. Explicit retry reruns failed items. Resume retains finished results and recovers unfinished work under the idempotency rules.
7. Complete the step with outputs in input order.
8. Emit transient `step.progress { done, total }` for completed items.

Per-item child flows obey the same result and retry rules. Item-aware mappers receive `item` and `index`.

## 5. Events and waits

Public `send` parses the event boundary before machine delivery. Correlation runs before handlers and buffering. A mismatch drops the event; correlation supplies no authentication.

Accepted `eventId` values live in the snapshot under bounded TTL and count retention. A duplicate returns a successful duplicate result with no deliveries and emits no new delivery. Defaults are 24 hours and 1000 ids.

Deliver step listeners in activation order, then the flow-level handler. A halt during that delivery stops later listeners and flow-level delivery. Stale delivery tokens also suppress hooks that have not started.

| Handler | Allowed result |
|---|---|
| `waitFor` | Void, keep, done, or fail |
| View `on` | Void or a declared navigation result |
| Runnable/child passive `on` | Void |
| Flow-level `on` | Void or cancellation |

Wait handlers cannot return navigation overrides. Completion follows the step's configured `next`. A wait output is its explicit done value or accepted event payload. Compose a wait followed by runnable work when an event should start a task.

Unmatched events can enter the FIFO inbox with expiry. Entry drains the oldest matching event; a keep-result can permit another drain. Expired entries leave the inbox. A flow-level handler is invoked at original send time, not repeatedly during inbox drains.

Event waits can have an alternate timeout target. When the deadline passes, mark the wait skipped with reason `timeout` and activate the target. The wait has no output, so its own `next` is not taken, its `exit` hook does not run, and required `needs` on it skip their consumers. Sleep steps have a durable deadline and finish when due. Clear obsolete timers when steps complete, skip, invalidate, or cancel.

## 6. Failure, fallback, and compensation

A failure under `onFailure: 'halt'` sets run status to `halted` and stops scheduling. Retain completed outputs and errors for operator recovery. Allow recovery, cancellation, events for remaining listeners, draft edits, child commands, and reset under their specific gates. Normal navigation returns `FLOW_HALTED`.

A runnable, item, or child step with `fallback` uses it after retry exhaustion or child halt/failure. Mark the source skipped with reason `fallback`, retain its error, and activate the fallback. Do not start the run-level halt or compensation policy for that recovered failure.

Under `onFailure: 'compensate'`, cancel active work, then unwind completed compensation entries in reverse completion order. Compensation receives its original output, reason, and stable idempotency key. Record a failed undo and continue best effort. The final outcome is terminal failed or cancelled with its compensation summary.

An explicit compensation command can retry failed entries, optionally starting from one step. Compensation is an external effect and may repeat after a crash.

## 7. Context, drafts, and invalidation

Hook context is a start-time snapshot. `update(patch)` applies a patch through the queue. `update(current => patch)` receives the latest committed context and applies atomically, allowing parallel increments without a read/modify/write race.

`setInput` patches a view draft and clears issues only for fields it changed. It supersedes older initialization results. `resetInput` restores a static default or restarts dynamic initialization with a new generation token.

Invalidation is explicit. It returns completed/failed/skipped work to idle, preserves view drafts, and moves output to `previousOutput`. Cascade invalidates transitive dependencies; cancel active dependents before resetting them. Invalidation does not compensate old side effects and does not infer staleness from context changes.

`progress(value)` emits a transient observer event using committed sequence metadata. It never changes persisted state, consumes no log slot, and cannot participate in replay.

## 8. Children

A child owns its context and dependencies. Map parent input explicitly. Inherit parent services only when they satisfy `RequiredDepsOf<child>`; merge services already bound by `child.provide` into each child creation.

Parent records store child summaries; parent snapshots embed full child snapshots. A completed child supplies the flow step's output. A halted or failed child fails that step unless fallback recovers it.

Event paths are relative to the observed run. Root observers see descendants through appended step ids; a child observer sees its own events at `[]`. Waiting facts use the same relative path model.

Disposing or cancelling a parent stops children. A child fatal interpreter failure or direct disposal must settle the parent flow step rather than leaving it active forever.

## 9. Resume and reset

Resume validates identity and state, then increments the epoch. A version migration receives unknown saved input and the previous identity. Its result must pass full validation with the new version in both envelope and state. Name mismatches do not migrate.

Within each run, overdue timers fire before recovery of interrupted work or buffered event delivery. Parent resume precedes child restoration. A resume barrier must retain stored child snapshots even before child runtimes restore.

Interrupted idempotent work reissues with its stored activation, attempt, and key. Non-idempotent work fails as interrupted. Keep saved drafts and finished item results, recover initializers without a result, and re-arm future timers for remaining time.

Reset clears execution state, timers, children, and compensation records while following the reset contract for run identity and event-id retention. It does not undo remote effects.

## 10. Queries and outcomes

Selectors for phase, readiness, view candidates, explanations, and progress summaries invoke no hooks. `waitingFor` is flat, with kind view/event/sleep, relative path, step, optional events, and deadline.

`awaitResult` resolves terminal results. `awaitOutcome` reports the next terminal, halted, or externally waiting state without disposal. Pure sleep and retry timers keep a convenience `wizard.run` invocation active. A sync violation names the work that requires async completion.

## 11. Verification

Machine tests use plain definitions, deterministic environments, and literal expected events/state. Runtime tests call the API as applications do. Keep focused regressions for these contracts:

- Navigation validation, veto, atomic source checks, back without exit, and cancellation during a transaction.
- Fan-out, data needs, routed targets held by their needs, exclusive branches, skip propagation, and unreachable joins.
- Retry deadlines, typed mapped failures, fallback, compensation order, and partial undo failures.
- Item concurrency, ordered results, finished-result retention, failed-item retry, and large collections.
- Event boundaries, bounded deduplication, correlation, FIFO buffering, atomic halt, and overdue resume.
- Commit visibility, stale tokens, unstarted-call abortion, child cancellation, and stored child retention.
- Replay of committed facts, version migration, terminal outcomes, parked outcomes, and disposal results.

Type tests prove reference inference, boundary input/output distinction, provided dependency requirements, and child/host contracts. A deliberate failing canary verifies the type-test runner.

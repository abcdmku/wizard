# @openwizard/core

## 0.1.0-next.1

### Minor Changes

- aa69846: `inspect(wizard).warnings` reports a new code, `SKIPPED_NEED`, for a `timeout.next` or `fallback`
  target that has a plain need on the step that starts it:
  
  ```ts
  const reply = step({ waitFor: { answered: () => {} }, timeout: { after: '1h', next: 'giveUp' } })
  const giveUp = step({ needs: { reply }, run: () => 'gave up' })
  ```
  
  A wait that times out is skipped, and so is a step that falls back. Neither has an output, so
  `giveUp` was skipped every time the timeout fired, with no error and no warning. Declare the need
  as `{ optional: reply }` and handle `undefined`, or remove the need.
  
  `ManifestWarning['code']` gains `'SKIPPED_NEED'`. Code that switches over every warning code needs
  a new case.
- aa69846: A project compiled with `declaration: true` can export a wizard, a step module, a header object,
  a projection, and values read from a run, with no type annotations. TypeScript reported TS4023 or
  TS4058 for these because the inferred types used names the package did not export.
  
  The main entry now exports `StepLinks`, `StepBinding`, `WizardOnArgs`, `WizardTypes` and
  `WizardState`. `Issue`, `SerializedError`, `Progress`, `ChildSummary` and `AnyStep` are interfaces
  under their own names. Each was an alias of an interface with no export, so the return type of
  `run.validate()`, `run.progress()` or a rejected `run.next()` could not be named either. Their
  shapes are the same.
  
  `parseFrame` and `parseWireCommand` from `@openwizard/core/mirror` return issues typed as the
  `Issue` of the main entry. The mirror entry declared its own copy, which no project could name.
- 13cfc63: Deduplicate external events and type their payloads.
  
  - `run.send(event, payload, { eventId })` remembers delivered ids in the snapshot. Redelivering a
    remembered id returns `{ ok: true, duplicate: true, delivered: [] }` and changes nothing, in any
    run status and after `reset()`; a later wait never consumes it. A payload rejected by the event
    boundary does not use up its id. `RunOptions.eventIds: { ttl, limit }` sets the window (default
    `{ ttl: '24h', limit: 1000 }`, oldest dropped first). The wire `send` command carries `eventId`.
  - `run.send` and `mirror.send` check a typed payload against the event schema's input type (the new
    `PayloadInput<F, E>` extractor; `PayloadOf` stays the parsed type). An `unknown` body still
    compiles and is parsed by the boundary.
- 3f99cf0: Rename the step option `idempotent` to `idempotencyKey`. It takes the same values: `true` for the
  default key, or a function that returns your own. The option now has the name of the `run`
  argument it feeds, so `idempotencyKey: ({ context }) => ...` and `run: ({ idempotencyKey }) => ...`
  read as one thing. The manifest lists the hook as `idempotencyKey`.
- 13cfc63: Move the wizard manifest to `@openwizard/core/inspect`: `inspect`, `toMermaid`, `toJSONSchema`,
  `formatTrace`, `traceLine` and the `Manifest`, `ManifestStep`, `ManifestEdge`, `GraphRetry`,
  `JSONSchema` and `ManifestWarning` types. The main entry no longer exports them.
  
  `inspect(wizard)` returns the full manifest: `description` and `meta`, draft 2020-12 JSON Schemas of
  the context, event payloads, view input and step outputs (read through Standard JSON Schema, so
  Zod 4 and ArkType work; other boundaries give `undefined`), and per step `waitsFor`, `completes`,
  `compensable`, `retry`, `child` and declared `targets`, drawn as `route` edges. `fingerprint`
  detects structure and schema drift. It is not a behaviour hash: hook bodies, `when` guards, retry
  and timeouts do not change it. A new `EXCLUSIVE_JOIN` warning flags an AND-join over alternative
  branches. `toMermaid` output now parses with Mermaid: quoted edge labels (`needs: first (any)`), a
  title, step labels, event nodes, and child subgraphs titled with the child wizard name.
  
  Every entry of `@openwizard/core` shares one runtime, so `inspect()` accepts wizards built with
  `boundary.trusted()` and the errors it throws pass `instanceof WizardError`.
  
  Devtools imports the manifest from `@openwizard/core/inspect`. It no longer re-exports
  `ManifestStep` / `ManifestEdge`, so import them from there. Route edges are drawn dashed, with no
  `?` port when targets are declared. The event log and timeline use `traceLine`.
- 13cfc63: Hook progress reaches Mirrors.
  
  - A hook's `progress(value)` now crosses the wire as a progress frame, and `mirror.observe(listener)`
    delivers the same `step.progress` event that `run.observe()` delivers locally, so one handler
    works for both. The event never enters frame state, snapshots or the log.
  - Progress is deny-by-default and opt-in per step: `steps: { upload: { progress: true } }`. A
    child wizard's steps opt in inside its nested `child` spec. The run-level `expose.progress: true`
    still only adds the `{ done, total, ratio }` summary to the state. Select projections opt in
    with `progress: { upload: true, sub: { child: { scan: true } } }`; omitting the map forwards
    no progress events. Mapped child events follow the same explicit nested exposure.
  - A source over a child run (`createMirrorSource(run.child('sub'), childProjection)`) forwards
    that child's progress with paths relative to the child wizard.
  - `createMirror({ onListenerError })` and `createMirrorSource(..., { onListenerError })`: as on a run,
    a subscriber or observer that throws
    no longer stops the other listeners or the transport; the error goes to `onListenerError`
    (default: rethrown asynchronously).
  - `Frame<S>` is now `SnapshotFrame<S> | ProgressFrame`, and `parseFrame` validates both kinds.
    `source.getFrame()` and `createMirror({ initial })` take a `SnapshotFrame<S>`. Code that reads
    `frame.state` from `subscribe` or a transport must check `frame.kind === 'snapshot'` first.
    `StepProgressEvent<F>` names the typed event.
  - `expose.waitingFor: true` adds the same flat view, event and sleep waits as `run.waitingFor()`.
    Paths are relative to the projected run, including nested projections and mapped children.
  - Mapped child projections expose child states or summaries in input order, with `null` slots
    for children not created yet. `mirror.child(step, index)` selects a mapped child, and its
    optimistic edits update the selected array item immediately. `retry` accepts mapped child steps.
  - Optimistic input patches use the same issue filtering as local runs, clearing the patched
    fields while preserving unrelated fields and form issues.
  - Mirror methods and wire commands use `startStep` and `startReady`. Removed names have no aliases.
  - Wire `expectedSeq` reaches the run's atomic version guard, including when payload parsing is
    asynchronous or other sources dispatch commands on the same run.
  - Mirror creation, transports and wire types live in `@openwizard/core/mirror`. Projections stay
    in the main entry; the wizard itself is passed to `defineProjection`.
  - Module projections work with runs created or resumed from `wizard.provide(...)`. Provided
    variants share authored identity; separately authored same-name definitions remain rejected.
    `ProjectionDefinition<F>` gives adapters the shared state facts without creation dependencies.
- 13cfc63: Use ordinary synchronous `waitFor` handlers. Their context updates and handler
  results commit together behind one persistence barrier, so a crash cannot leave
  the updated context ahead of the wait's completion. Tagged wait reducers are removed.
- 101aaee: Remove the `dependsOn` step option. Steps are now linked two ways: `next` starts a step, and
  `needs` waits for another step and passes its output on. A definition that still sets
  `dependsOn` fails to type-check and throws `DEFINITION_INVALID` when it is built.
  
  | Before | After |
  |---|---|
  | `dependsOn: ['audit']`, wait for a step | `needs: { audit }`, and ignore the value |
  | The same, where a skipped `audit` should not stop the step | `needs: { audit: { optional: audit } }` |
  | `dependsOn: { any: ['a', 'b'] }` | `needs: { first: { any: [a, b] } }` |
  | `dependsOn` on a step listed in a router's `targets` | The same `needs`. The router still decides whether the step runs |
  | `dependsOn` on a step another step starts with a static `next` | `needs` on both, for example `needs: { review, audit }` |
  
  `needs` takes step objects, so create the producers first with `const audit = step(...)`.
  
  Three differences from `dependsOn` matter when you migrate:
  
  - A skipped producer skips a step with a plain need on it. `dependsOn` let the step run. Use
    `{ optional: producer }` to keep that.
  - An `any` need waits for a producer that finished. A skipped producer does not satisfy it.
  - A need starts its step once the producers finish, where `dependsOn` only held a step that
    something else started. The exception is below.
  
  A step listed in the `targets` of a function `next` now starts only when that function returns
  it. Its needs hold it and never start it. Before, a target with needs started as soon as its
  producers finished, even when the router chose another branch, and a `not-taken` target came
  back to life when a producer finished later.
  
  Also removed, because only `dependsOn` used them: the `dependsOn` field of `ManifestStep`, the
  `dependsOn` edge kind, its Mermaid and devtools labels, and the `NEVER_ACTIVATES` warning. A step
  whose producers cannot be reached is reported as `UNREACHABLE`. The reason code
  `deps-unmet:<id>` and the error `DEPS_UNREACHABLE` stay and now always refer to a need.
  `EXCLUSIVE_JOIN` still warns about a step with plain needs on exclusive branches.
  
  The manifest fingerprint of every wizard changes once, because the hashed structure no longer
  has a `dependsOn` entry.
- 13cfc63: Resume tolerates definition drift, and failed commands explain themselves.
  
  - Steps added to a wizard since a snapshot was taken resume `idle`. A snapshot step the wizard no longer
    defines is rejected with a message that points at `renameSteps`.
  - `migrate` results are stamped with the wizard's current version, so a migration only rewrites what
    changed: `migrate: (snapshot) => renameSteps(snapshot, { review: 'approve' })`.
    `renameSteps(snapshot: unknown, renames)` returns `unknown`.
  - A snapshot whose values share an object (the same object in context and in a step output)
    resumes; only real cycles are rejected.
  - `{ ok: false }` command, navigation and send results carry readable messages (for example
    `no step is waiting for 'hello' and unmatched events are not buffered`) next to their stable
    `code`.
- 4d63ba7: Rename `retry.attempts` to `retry.retries`. The value always meant extra runs after the first
  failure, so `attempts: 3` ran a step four times while `attempt` in hook arguments and events
  counted runs from one. `retry: { retries: 3 }` now says what it does. The manifest field
  `GraphRetry.attempts` is `GraphRetry.retries`, the Mermaid tag reads `3 retries`, and the
  definition error is `retry.retries must be a non-negative integer`. Behaviour is unchanged.
- 13cfc63: Runs report outcomes instead of hanging.
  
  - `wizard.run(input)` and `wizard.runSync(input)` return a `RunOutcome`: a terminal `RunResult`, a
    `RunHalted` (the failed step, its error and a `snapshot` to resume) or a `RunWaiting` (what the
    run waits on and a `snapshot`). A failed step never throws and never hangs. Retry backoff and
    sleeps keep `run()` going. `runSync` throws `SYNC_VIOLATION` naming the step when a hook returns
    a promise or a timer is needed. A `context` rejected by its boundary still throws
    `WizardError('BOUNDARY_REJECTED')`.
  - `run.awaitOutcome()` waits for the next outcome that needs the outside world without disposing
    the run. `run.waitingFor()` and `run.explain(step).waitingFor` list the waits as one flat array of
    `{ kind: 'view' | 'event' | 'sleep', path, step, events?, deadline? }`; `path` locates child runs
    (`[]` is the run itself, typed by the wizard).
  - A halted child run halts its parent; the parent's `RunHalted.failure.child` is the child's own
    halted outcome. Recover it through `run.child(step)`.
  - `run.retry(step, { patch })` and the wire command `{ type: 'retry', step, patch }` merge a context
    patch before the step re-runs.
  - New exports: `RunOutcome`, `RunHalted`, `RunWaiting`, `WaitingFor`.
  - After `dispose()` every command resolves a `DISPOSED` value instead of throwing, an in-flight
    `validate()` resolves one `DISPOSED` issue, `attach()` / `subscribe()` / `observe()` /
    `subscribeResult()` are inert, `child(step)` returns the child that was disposed with the run,
    and `awaitOutcome()` rejects with `RunLifecycleError('RUN_DISPOSED')`.
- 13cfc63: Add durable sync or async view draft initializers and principal-scoped select projections. Mirror
  sources can now authorize typed commands against the authenticated projection scope and return a
  `FORBIDDEN` result without putting the scope on the wire.
- 13cfc63: Reduce the authoring model to three structural kinds: `step`, `view`, and `child`.
  Plain steps use `run`, `waitFor`, `sleep`, or `next` routing. Typed joins, mapped
  work, and static fallback paths compose these behaviors. Remove the `task`,
  `wait`, `decision`, and `final` constructors and kinds.
- 4d63ba7: Add `toMarkdown(inspect(wizard))` to `@openwizard/core/inspect`. It renders the manifest as one
  page: the Mermaid diagram, a table of when each step starts, what it does and where it leads,
  each step's typed needs, guard, retry, timeout, undo hook and schemas, then the context fields,
  events and warnings. The output is deterministic, so a generated page can be committed and
  checked for drift.
  
  `defineWizard` options now accept `description` and `meta`. The compiler and the manifest already
  carried them for the wizard, but the option type rejected both.
  
  Ship `AGENTS.md` in the package: the authoring model, rules and a tested example for coding
  agents. Public doc comments no longer name internal constructors or old version numbers, and the
  garbled characters in several of them are repaired.
- 0e93893: A wait that times out is now skipped. Before, `step({ waitFor, timeout: { after, next } })`
  finished as `done` with output `undefined`, so every step that needed the wait had to check for
  `undefined`, and such a step ran even though the run had taken the timeout path.
  
  - The wait's status is `skipped` and its `skipReason` is `'timeout'`. The log records
    `step.skipped { reason: 'timeout', next }` where it used to record `step.done`.
  - `timeout.next` starts as before. The wait's own `next` is not taken and its `exit` hook does
    not run. A handler that is still running when the deadline passes has its `signal` aborted.
  - A step with a plain `needs` on the wait is skipped with reason `needs-skipped`.
    `{ optional: wait }` supplies `undefined`, and `{ any: [wait, other] }` waits for another
    producer.
  - `OutputOf` of a wait no longer includes `undefined` because of a timeout.
  - A timed-out wait is never the wizard's output. A sink that finished keeps the result.
  
  To migrate, find each step that needs a wait with a `timeout`. If it must also run after a
  timeout, change `needs: { reply }` to `needs: { reply: { optional: reply } }`. Otherwise remove
  its `undefined` check.
- 13cfc63: Add `Run.whenIdle()` so hosts can await the current FIFO drain, its synchronous follow-up
  batches, and their `beforeEffects` barriers without waiting for future timers or long-running task
  hooks.
- 13cfc63: Use object configs for `step`, `view`, and `child` constructors. Plain steps
  run work, wait for events, sleep, or route through `next`. Typed `needs` joins
  activate consumers and expose producer outputs to their hooks. Object references
  work in every edge position and assembly rejects unknown references.
  
  Wizard output is the output of a completed sink, or an explicit definition-level
  selector. Fallback and timeout destinations are alternate paths when computing
  sinks. Positional step functions, `route`, `complete`, and wait reducers are removed.
- 92251c6: Use one vocabulary. The word "flow" is gone from the public API, the messages and the docs.
  
  | Word | Meaning |
  |---|---|
  | wizard | The definition returned by `defineWizard` |
  | run | One execution of a wizard |
  | step | One unit of a wizard. The three kinds are `step`, `view` and `child` |
  | child | A step that runs another wizard, and the nested run it creates |
  | manifest | What `inspect(wizard)` returns |
  
  There are no aliases for the old names. Snapshots saved by an earlier pre-release carry `flow`
  where `wizard` is now expected, so `wizard.resume` rejects them with `SNAPSHOT_INCOMPATIBLE` and
  the reason `wizard: expected { name, version }`.
  
  ### Events
  
  | Old | New |
  |---|---|
  | `flow.started` | `run.started` |
  | `flow.done` | `run.done` |
  | `flow.failed` | `run.failed` |
  | `flow.halted` | `run.halted` |
  | `flow.compensating` | `run.compensating` |
  | `flow.compensated` | `run.compensated` |
  | `flow.cancelled` | `run.cancelled` |
  | `flow.resumed` | `run.resumed` |
  | `flow.reset` | `run.reset` |
  | `flow.status` | `run.status` |
  | `event.flowDelivered` | `event.wizardDelivered` |
  
  `RUN_EVENT_TYPES` lists the new names. `event.wizardDelivered` means the wizard-level `on`
  handler took the event.
  
  ### Step kind and constructor
  
  | Old | New |
  |---|---|
  | `flow(childWizard, config)` | `child(childWizard, config)` |
  | `({ step, view, flow, steps }) => ...` | `({ step, view, child, steps }) => ...` |
  | Step kind `'flow'` (`StepKind`, step records, manifest steps) | `'child'` |
  | Mermaid subgraph id `<step>___flow` | `<step>___child` |
  | Devtools `data-kind="flow"` | `data-kind="child"` |
  | Devtools event log `data-family="flow"` | `data-family="run"` |
  | Devtools canvas class `owd-flow` | `owd-canvas` |
  
  The manifest fingerprint of a wizard with a child step changes, because the step kind is part of
  it.
  
  ### Types
  
  | Old | New |
  |---|---|
  | `Flow` | `WizardDefinition` |
  | `AnyFlow` | `AnyWizardDefinition` |
  | `WizardDefinition` (the options of `defineWizard`) | `WizardHeader` |
  | `FlowStep` | `WizardStep` |
  | `FlowOutput` | `WizardOutput` |
  | `ChildFlowOf` | `ChildWizardOf` |
  | `ProjectionFlow` | `ProjectionWizard` |
  | `FlowOnArgs` | `WizardOnArgs` |
  | `FlowFailure` | `TerminalFailure` |
  | `FlowGraph` (`@openwizard/core/inspect`) | `Manifest` |
  | `FlowGraphNode` | `ManifestStep` |
  | `FlowGraphEdge` | `ManifestEdge` |
  | `FlowWarning` | `ManifestWarning` |
  | `FlowOf` (`@openwizard/react`) | `WizardOf` |
  | `FlowGraph`, `FlowGraphProps` (`@openwizard/devtools`) | `WizardGraph`, `WizardGraphProps` |
  | `FlowAccess` (`@openwizard/http`) | `RunAccess` |
  
  `Wizard` still extends `WizardDefinition`, and `AnyWizard` is still the constraint for code that
  creates or resumes runs.
  
  ### Error codes and reasons
  
  | Old | New |
  |---|---|
  | `FLOW_TERMINAL` | `RUN_TERMINAL` |
  | `FLOW_HALTED` | `RUN_HALTED` |
  | `FLOW_NOT_STARTED` | `RUN_NOT_STARTED` |
  | `FLOW_COMPENSATING` | `RUN_COMPENSATING` |
  | `FLOW_FAILED` | `RUN_FAILED` |
  | `NOT_A_FLOW_STEP` | `NOT_A_CHILD_STEP` |
  | `flow-terminal` | `run-terminal` |
  | `flow-halted` | `run-halted` |
  | `flow-not-started` | `run-not-started` |
  | `flow-compensating` | `run-compensating` |
  | `not-a-flow-step` | `not-a-child-step` |
  | Error name `FlowFailure` | `RunFailed` |
  | Error names `ChildFlowFailed`, `ChildFlowCancelled`, `ChildFlowDisposed` | `ChildRunFailed`, `ChildRunCancelled`, `ChildRunDisposed` |
  | Hook name `flowOn` in a `HOOK_MISSING` message | `wizardOn` |
  
  Messages say "wizard" for a definition (`wizard 'checkout' is invalid`), "run" for an execution
  (`charge completes the run and cannot be skipped`) and "child step" for the step kind
  (`'pay' is not a child step`).
  
  ### Snapshot and wire fields
  
  | Old | New |
  |---|---|
  | `snapshot.flow` | `snapshot.wizard` |
  | `snapshot.state.flow` | `snapshot.state.wizard` |
  | `run.flow` | `run.wizard` |
  | `projection.flow` | `projection.wizard` |
  | Devtools props `flow` (`Devtools`, `WizardGraph`, `GraphInput`) and `RunSource.flow` | `wizard` |
  | HTTP `access: { flow: [...] }` | `access: { run: [...] }` |
  | Span attributes `openwizard.flow.name`, `openwizard.flow.version` | `openwizard.wizard.name`, `openwizard.wizard.version` |
  | Span attributes `openwizard.flow.outcome`, `openwizard.flow.error_code` | `openwizard.run.outcome`, `openwizard.run.error_code` |
  
  No SQL column or migration changes. The stores keep a snapshot as one JSON value. The `flows`
  option of `createOAuth2ScopeProvider` keeps its name, because it is the OAuth flows object of
  OpenAPI.
  
  Function parameters named `flow` are now `wizard` (`inspect`, `parseCommand`, `parseWireCommand`,
  `replay`, `createDurableRun`, `resumeDurableRun`, `createDurableHost`). Calls do not change.
- 13cfc63: Compile callback-authored wizards with object step configs, named data joins, map steps, durable sleeps and static fallback edges. Resolve object references across routing, gates, joins, timeouts, fallback and view event handlers. Reject invalid definitions before a run starts, including missing routing targets, empty graph declarations, foreign or duplicate step references and dependency cycles.
  
  Use normal successors and data consumers to determine sink outputs. Fallback and wait timeout edges preserve the source's happy-path output. Inspection reports named join modes, map and sleep facts, recovery edges and warnings for missing or multiple sinks; Mermaid and structural fingerprints reflect these patterns. Inspect manifests omit unbounded item concurrency so they remain JSON serializable.
- 13cfc63: Move mirror creation, frame sources, transport and wire types to
  `@openwizard/core/mirror`. The main, mirror, inspect and testing entries share
  one runtime. Publish the wizard/run API, typed joins, durable mapped recovery,
  per-item child access, and optimistic command guards in every supported module format.
  
  The expanded core measures about 54 kB minified with Brotli, up from 47.4 kB
  before this pass. Its size limit is now 55 kB. A bundle audit found no external
  dependency inflation; the added map recovery and child coordination remain in core.
- 13cfc63: Add mapped steps and child wizards with bounded concurrency and outputs in input order. Item snapshots, completed results, retry attempts, and idempotency keys survive restarts. Manual retry repeats failed items and preserves successful outputs. Each completed item reports transient `{ done, total }` progress to observers.
- 13cfc63: Activate typed data joins from their producers without explicit next edges. Partial joins report DEPS_UNREACHABLE when remaining producers never activate. Required needs propagate skipped outputs, any needs choose an actual completion, and optional needs allow absent outputs. Untaken branches skip unreachable successors while alternate timeout paths can reactivate their joins. Explicitly invalidated work stays available for navigation and rerunning.
- 13cfc63: Add durable sleep steps with deadlines preserved across restarts. Static fallbacks on runnable and child steps continue the run after retry exhaustion while retaining the original failure on the skipped step.
  
  Default wizard output comes from the last completed sink. Fallback and timeout routes remain alternate edges, so they do not remove a step's happy-path output.
  
  Wait handlers return payloads or explicit done values and reject next overrides. Passive event handlers can coexist with a wait. Remove synchronous wait reducers and completing-step hooks.
  
  Cancelling or compensating during navigation aborts its transaction without recording a false guard verdict. Routing steps output undefined, validate declared targets, and exclude untaken branches only after the transition commits. Exit hooks no longer receive direction.
  
  Mapped child steps park when their unfinished children wait for external input, while retry timers keep them running. Resuming restores automatic navigation after an already committed step completion without repeating its work.
  
  Child commands can address one mapped item through its index path or a stable nonnumeric key. Invalidating a child step disposes its previous child runtimes.
- 13cfc63: Run mapped steps with bounded concurrency, ordered results, per-item retries, saved item results and transient completion progress. Child maps retain each item's own child runtime across resume.
  
  Every step hook receives the outputs selected by its typed needs. Child wizards inherit their provided dependencies and validate the combined dependencies at creation.
  
  Restore child snapshots before committing the parent resume batch, identify the exact message behind each host barrier, and abort navigation guards when their transaction is cancelled.
  
  Host barriers now stage child disposal with resets and invalidation, preventing a later resume from restoring removed children. Commands can check their expected version when they reach the interpreter queue; cancelled navigation returns `CANCELLED` without recording a false guard verdict.
  
  Compensation uses a distinct idempotency key for each completion of a looping step. Retrying that compensation after resume keeps the same key.
  
  Editing view input clears validation issues only for the patched fields and their nested values. Issues for unrelated fields and the whole form remain until validation runs again; replacing or resetting all input clears every issue.
- 13cfc63: Reject non-JSON mapped and adapter errors before they enter snapshots, and retain validated adapter data on serialized errors. Keep error mapping separate for concurrent map items and retries.
  
  Cancel navigation hooks through their abort signals without cancelling unrelated running work.
  
  Run callbacks can return or await a run adapter. The adapter receives the same arguments and abort signal, its output boundary is used unless the step declares one, and existing error mapping and retry policies still apply. Declare step output boundaries when persisted results need revival, such as Dates.
- 13cfc63: Rename live instances to `Run`, with `startStep` and `startReady` methods and commands. A wizard is its definition and carries provided dependencies into every creator. Projections defined for a base wizard work with its provided variants, while separately authored definitions remain rejected.
  
  Add atomic optimistic dispatch through `expectedVersion`, and associate durable command results with the exact committing command. Interrupted navigation returns `CANCELLED`.
  
  Restore the complete child tree before the first resume commit, including when a sibling dependency mapper fails. Mapped children can be addressed by item index or stable key, with readable indexed wait and event paths. Reject snapshots missing a live mapped child, revive per-item outputs, and migrate indexed child addresses and sleep/retry timers when steps are renamed.
  
  Omitted optional dependency objects default to an empty bag at create, resume, and child boundaries. Explicit undefined and scalar dependency values keep their boundary semantics.
- 13cfc63: Preserve schema-transformed values in saved map results, including finished items from halted maps and each child wizard's context. Restore default sink outputs and terminal results through the sink's boundary.
- 13cfc63: Infer object step configs and typed data joins through checked wizard assembly. Wizards carry resolved sink outputs and the dependencies still required after `provide()`. Preserve transformed event inputs for `send`, close wait handler results, type timeout outputs as possibly absent, and require item selectors and retry ids for mapped child steps.
  
  Run adapters are records with typed execution metadata and JSON error channels. A run callback may return or await an adapter, preserving typed item, needs, service, output and retry inference. Assembly rejects returned adapters that require incompatible arguments. Generic step modules must use the same context, events and dependency types as the wizard that assembles them.
- 13cfc63: Define wizards with `defineWizard(options, ({ step, view, child, steps }) => steps(map))`.
  The returned wizard is the definition and owns `create`, `resume`, `run`, `runSync`,
  their async variants, and immutable dependency provisioning through `provide`.
  Bound dependencies travel into child runs and durable hosts. `RequiredDepsOf`
  describes the dependencies a caller still needs to supply.

### Patch Changes

- 13cfc63: Hooks and state follow the commit boundary, in child runs too.
  
  - A hook call that is cancelled or superseded before its turn never runs. For example, a `cancel()` or
    `skip()` issued from an `observe` listener, or a guard whose transition an earlier guard already
    rejected. The call is reported as aborted instead.
  - A child run's hook waits until its parent has processed the messages queued before it. A parent
    `cancel()` issued from a listener or during a pending barrier stops the child before its hook runs.
  - `getState()` and `getSnapshot()` show only committed state. While a `beforeEffects` barrier is
    pending, and after it rejects, they return the previous batch with the child snapshots committed
    with it. The barrier receives the staged snapshot, and hook `progress` events carry the committed
    `seq`.
  - A synchronous failure while processing a command, such as an `ids` generator that throws,
    disposes the run like a failed barrier. Pending and later commands resolve `DISPOSED` instead of
    hanging, no child is restored into a run whose resume failed, and `child(step)` still returns the
    disposed child.
  - A child run that stops on its own (a fatal error, or a direct `dispose()`) fails its child step
    instead of leaving the parent waiting.
- 13cfc63: Deadlines are absolute and event delivery is atomic.
  
  - On resume, a run fires its overdue wait timeouts and retries before it re-issues its interrupted
    idempotent runs. A run that an overdue deadline ended is not re-issued. The order holds per run:
    a parent resumes before its child runs are restored.
  - When a `waitFor` handler or reducer halts the run during one `send` (it throws or returns
    `{ fail }`), the handlers of that event that have not started yet do not run: later step
    listeners and the wizard-level `on` handler. A run that was already halted before the `send` still
    delivers it.

## 0.1.0-next.0

### Minor Changes

- 0a488d0: Initial public release.
  
  - `defineFlow` + three pre-bound constructors (`step`, `view`, `flow`); plain-step behavior comes from `run`, `waitFor`, `route`, or `complete`; every id, payload, and hook is typed by the flow.
  - `createRun` / `createRunAsync` / `resumeRun` / `resumeRunAsync` over a pure event-sourced machine: sync-commit, batch atomicity, results as values (`CommandResult` / `NavResult` / `SendResult`, one `code` + `message` vocabulary), `WizardError` for programmer errors only.
  - Typed terminal outcomes (`RunResult<F>` / `FlowFailure<F>`): `result()`, `awaitResult()` and `subscribeResult()` preserve mapped task errors, distinguish cancellation from compensation failures, and reject pending waiters on reset/dispose; terminal metadata survives resume.
  - Navigation, drafts, typed events with buffering and TTL, runnable-step retry/timeout/concurrency, sagas, nested flows, and reset.
  - Persistence: `Store` port, `createMemoryStore`, auto-save / `save()`, snapshots JSON-checked before every write (`onPersistError`, `persist.failed`), resume that re-validates every boundary and applies the recovery matrix; single-owner in this release.
  - Observability: `observe` / `log` domain events with `seq` / `path` / `causedBy`, `explain(step)`, `inspect(flow)`.
  - `@openwizard/opentelemetry`: optional safe workflow, task-attempt, compensation, nested-flow,
    resume and external-event tracing with `@opentelemetry/api` as a peer dependency.
  - Projections and the wire: `defineProjection` (deny-by-default), `project`, `dispatch` + `parseCommand`; the Mirror protocol — `createMirrorSource`, `createMirror`, `Transport`, `Frame` / `WireCommand` / `WireAck`, `parseWireCommand` / `parseFrame`.
  - `@openwizard/core/testing`: `createTestScheduler` (virtual time) and `createLocalTransport` (in-process loopback).
  - `@openwizard/react`: `bindReact<typeof flowOrProjection>()` → `Provider` (with `serverSnapshot` for SSR / hydration), `useSnapshot`, `useCurrent`, `useStep`, `useSelector`, `useActions` over a `FlowRun` or a `Mirror`.
  - Eight tested examples and the API reference in `packages/core/README.md`.

### Patch Changes

- Add the durable storage and coordination contract with leases, fencing tokens,
  snapshot CAS, command and event dedupe, timer claims, a linearizable in-memory
  adapter, retention hooks, and the opt-in `createDurableRun` /
  `resumeDurableRun` host integration. The host is at-least-once and makes no
  exactly-once task guarantee; normal `createRun` and core `Store` remain
  single-owner APIs.
- Add the stable Effect 3.22 task adapter, typed durable failures, and native
  Effect helpers for starting and awaiting a FlowRun.

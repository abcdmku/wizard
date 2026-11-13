# @openwizard/devtools

## 0.1.0-next.2

### Minor Changes

- 11fae09: `<WizardGraph>` remembers the layout and height of a graph it has drawn, so it opens in place the next time. `prepareGraph(inspect(wizard), { width, autoHeight })` lays a graph out before it is shown. The dev UI prepares every wizard, keeps a run on screen while the next card arrives, and no longer opens a run on a loading line.
- 48dd255: The graph shows a whole wizard at a readable size. Step cards are compact: the step id, then one row with its status, or with its kind (`form`, `wait`, `timer`, `each`, `child`, `route`) and the one fact that tells most. A kind that repeats the step id is left out. Everything else is in the card's tooltip. Step ids, status words and edge labels stay at 11px or more on screen whenever the whole graph is drawn at a readable size. Edges follow right-angled routes that keep clear of the cards and leave room for their labels, and two edges between the same pair of steps are drawn as one line that carries both labels. A step that needs any one of several steps says so on a third line inside its card (`any of ack, escalate`, or `any of 2 steps` when the names do not fit), so nothing covers an edge or an arrowhead. A step that runs per item keeps `each · 2 at a time` on that line while the run is live. Edge labels read as plain phrases: `need: values`, `optional need: by`, `times out after 48h`, `falls back`. A line that says two things puts each on its own line (`optional need: by` above `times out after 48h`). Durations read as whole hours under 72 (`48h`), otherwise as the largest whole unit (`7d`, `5m`).
  
  `<WizardGraph>` has new props:
  
  - `direction`: `right`, `down` or `auto` (default). `auto` lays the layers top to bottom unless running them right draws the graph clearly larger, or the graph is one short row of steps.
  - `autoHeight`: the graph sets its own height to fit the wizard, between a minimum and a maximum. A short chain gets only the height it needs.
  - `attention`: the keys of the steps that wait on a person. They show `waiting on you`. A step that is undoing, done or failed keeps its word and gets a ring instead.
  - `ended`: the run has ended, so a step it never started shows `not run`.
  - `runStatus`: the run's status. While the run is undoing (`compensating`), or once it is done, failed, cancelled, halted or undone, a step it never started shows `not run`.
  - `wheelZoom`: pass `false` so the mouse wheel scrolls the page. Pinch and Ctrl with the wheel still zoom, by 1.2 for each wheel notch.
  - `attribution`: pass `false` to hide the React Flow link when you credit React Flow elsewhere.
  
  Status words are a fixed set: running, waiting on you, waiting, retrying, failed, undoing, undone, done, skipped, cancelled, blocked and not run. A step a live run has not started is `blocked` while it can still start and `not run` once it cannot: a need it cannot run without was skipped or failed, every step of an `any` need was, or every way into it closed (a timeout target once the wait finished in time, a fallback once the step succeeded). Running is blue; waiting, waiting on you and retrying are amber. A step that retries shows `retries 2` before it runs and `2 of 3` while it retries or after it failed; `collectStatuses` now reports each step's `attempt`. A graph that fits at a readable size is shown whole and stays whole as the run moves on, and a narrow pane such as a phone always shows the whole graph. When the graph follows a run that is too large to show whole, the view holds whole steps, a step cut by the edge is covered, and a button such as `← 3 steps` moves the view to the steps beyond that edge. A focused step that is out of view is brought into view by the least movement, Enter or Space selects it, and Escape clears the selection. The entry marker is no longer a tab stop. The path the run took is drawn dark, including a timeout or fallback line the run went along, which keeps its dashes; a timeout or fallback line the run can no longer take fades. Fitting the graph, and the fit button, keep the edge labels in view as well as the steps. In a narrow pane a graph too wide to read is laid out again as narrow as it goes, so step ids stay at 11px or more on a phone.
  
  In the dev UI's dark mode, the graph's attention ring and current-step ring show again.

## 0.1.0-next.1

### Minor Changes

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
- 28b48a1: `<WizardGraph follow>` keeps a wide graph readable: it draws the steps at a readable size, centred on the ones that are running, waiting or failed, and moves the view as the run does. The dev UI turns it on.
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
- 13cfc63: React bindings and devtools accept a `Run` created by the wizard itself. React actions use
  `startStep` and `startReady`, preserve event IDs in child commands, and accept typed retry
  context patches. Mirror types and constructors come from `@openwizard/core/mirror`.
  
  `useChild(step, index)` selects one mapped child by its input index. Mapped steps require the
  index, while ordinary children retain `useChild(step)`. Indexed bindings read exposed nullable
  child arrays through a Mirror and preserve the selected item when sending scoped commands.
  
  Devtools exports `RunSource` and `isRunSource` for its structural local-run input. The old
  `FlowRunSource` and `isFlowRunSource` names are removed.
  
  The graph labels named needs and fallback edges. Step cards and the inspector show map
  concurrency, sleep durations, sink roles, and persisted item results.
  Mapped child graphs and inspector selections use each child's input index and show exposed
  per-item state from Mirrors.

### Patch Changes

- beafcb3: A step card in the graph shows its status with a border on all four sides. It used to show a
  thick stripe on the left edge only.
- ed29073: `<WizardGraph>` leaves less space between layers and around the graph, so the steps of a wide wizard are drawn larger.
- Updated dependencies [13cfc63]
- Updated dependencies [aa69846]
- Updated dependencies [13cfc63]
- Updated dependencies [aa69846]
- Updated dependencies [13cfc63]
- Updated dependencies [3f99cf0]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [101aaee]
- Updated dependencies [13cfc63]
- Updated dependencies [4d63ba7]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [4d63ba7]
- Updated dependencies [0e93893]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [92251c6]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
  - @openwizard/core@0.1.0-next.1

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

- Updated dependencies
- Updated dependencies
- Updated dependencies [0a488d0]
  - @openwizard/core@0.1.0-next.0

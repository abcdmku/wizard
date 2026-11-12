# @openwizard/react

## 0.1.0-next.1

### Minor Changes

- 13cfc63: - `useRun(create, deps?)` owns a `Run` or a `Mirror` inside a component: created once during
    render (server rendering and hydration have it), kept through StrictMode's simulated remount,
    recreated when `deps` change, disposed after the component unmounts. Renders React throws away
    never leak a source.
  - Server rendering has one mechanism: seed the client source with the state the server rendered
    (`createMirror({ initial })`, `wizard.resume(snapshot)`) and create it with `useRun`. The `Provider`'s
    `serverSnapshot` prop is removed; hooks read the live source on the server and during hydration.
  - `bindReact<typeof projection>()` returns a `MirrorBinding` with `useConnection()` (`connected`,
    `connect`), which re-renders when the transport drops or reconnects. Bindings over a wizard stay
    `ReactBinding` (a local run has no transport).
  - `useStep(view)` binds helpers to views only: `next()` / `back()` resolve `NOT_ACTIVE` without
    sending anything when that view is not the current one; `issuesFor(field?)` filters the view's
    issues by field (path-less issues without an argument) and is typed only where the record
    carries `issues` (always over a run, over a projection when the step exposes `issues: true`).
  - Step records over a `Run` carry the live `phase` (`validating` while an async `validate`
    hook runs, `running`, `retrying`, `waiting`, …), like projected records.
  - `useActions()` is the source itself: `RunActions` over a run (commands plus `validate`,
    `explain`, `progress`), `Actions` over a Mirror (every command resolves a `MirrorResult`,
    `TRANSPORT_FAILED` instead of rejecting). `send` checks the payload against the event's schema.
  - New exports: `useRun`, `MirrorBinding`, `BindingOf`, `Connection`, `ActionsOf`, `RunActions`,
    `CommandResultOf`, `FieldOf`.
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

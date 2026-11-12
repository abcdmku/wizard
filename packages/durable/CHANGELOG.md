# @openwizard/durable

## 0.1.0-next.1

### Minor Changes

- 13cfc63: Host durable runs by key and move the store protocol to its own entry.
  
  - `createDurableHost(wizard, { store, ownerId?, renew?, deps?(key), onLeaseLost? })` returns
    `{ create(key, input), open(key), send(key, event, payload, { eventId }), dispatch(key, command, { commandId }), dispose() }`.
    It keeps live runs open, drops a run whose lease was lost and reopens it on the next call,
    releases a run's lease once it reaches a terminal result, and releases every lease on
    `dispose()`. Open failures (`LEASE_BUSY` with `retryAt`, `RUN_NOT_FOUND`, `LEASE_LOST`) are values.
  - `createHostRegistry` remains for hosts that are not durable runs: same-key open sharing,
    generation-safe invalidation, expected-value eviction, and abortable disposal.
  - The `DurableStore` protocol (`DurableStore`, `Version`, `Lease`, `CommitInput`, the dedupe and
    timer claim types, `DurableStoreError`) moves to `@openwizard/durable/store`. The new
    `@openwizard/durable/testing` entry exports `durableStoreContract`, the conformance suite every
    adapter should pass.
  - Event dedupe uses core's `send(…, { eventId })`: the id is stored in the run snapshot and
    committed with the event's effects. `DurableEventOptions` is `{ eventId, correlationId? }` and a
    redelivered id returns `{ ok: true, duplicate: true, delivered: [], version }`, also after a
    takeover. Event `digest`/`expectedVersion`, `EVENT_PENDING`, and the dedupe claim `kind` are gone;
    command ids keep their digest check and `expectedVersion` gate.
  - `DurableRunHost.send` and `DurableHost.send` type-check a typed payload exactly like
    `Run.send` (excess properties are rejected; an `unknown` body is still accepted).
    `host.claimTimer` is removed. `release()` and `dispose()` wait for commands and
    events already sent to the host.
  - `renew: 'manual' | { everyMs }` replaces `renewEveryMs`; `everyMs` must be shorter than the
    lease TTL. The default TTL comes from the new required `DurableStore.leaseTtlMs`.
  - `CommitInput.completeTimers` (an array) replaces `completeTimer`: the host completes every timer
    claim a committed batch consumed.
  - A command can no longer run twice after a crash. The first snapshot committed after `dispatch`
    hands a command to the run carries `CommitInput.applyDedupe`, which marks its claim `applied` in
    the same write. A newer owner never takes an applied claim over: `claimDedupe` answers
    `{ status: 'applied' }` and the host returns `COMMAND_INTERRUPTED` instead of running the command
    again. `completeDedupe` completes a pending or applied claim; the conformance suite covers both.
  - `DurableRunOptions` applies `redact` to every snapshot before the store sees it, and no longer
    accepts `debounceMs` or `onPersistError`. Host failures carry a `message`.
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
- 13cfc63: Accept wizards directly and preserve dependencies supplied through `provide()` in durable creation and restoration. Host dependency factories require only dependencies that remain unprovided.
  
  Persist command results with the exact command or completed navigation snapshot so a worker crash after the database commit still replays the original result. Unrelated local batches cannot mark an external command applied. An interrupted asynchronous navigation with no committed final result continues to return `COMMAND_INTERRUPTED`.
  
  Give each durable dispatch a private command identity even when callers reuse the same command object locally. Recheck optimistic versions after asynchronous payload parsing and persist stale refusals for replay across workers.
  
  Keep high-level opened handles usable across terminal lease release and awaited I/O. External handle commands and events reopen their key when needed, and explicit release waits for pending operations. Finish resumed drains before exposing a host so overdue deadlines precede late deliveries.

### Patch Changes

- 704fe06: The memory store and the Drizzle adapters now run the same input checks, so malformed input fails
  the same way on every store.
  
  `@openwizard/drizzle`: `commit` checks the lease and `expected` before the record and the
  completion markers. A `next`, `applyDedupe`, `completeDedupe` or `completeTimers` entry that is not
  an object throws `DurableStoreError` with code `INVALID_ARGUMENT` instead of a `TypeError`. A `next`
  without a `value` key throws `INVALID_ARGUMENT` before any storage call instead of
  `NOT_SERIALIZABLE` after the lease check. The messages for a version that is not an object and for
  a missing `next.version` now match the memory store.
  
  `@openwizard/durable`: `sweep` on the memory store accepts the limits the Drizzle adapters accept.
  A `limit` of `Infinity`, or an integer above `Number.MAX_SAFE_INTEGER`, throws `INVALID_ARGUMENT`.
  Omit `limit` to sweep without one.
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

- Add the durable storage and coordination contract with leases, fencing tokens,
  snapshot CAS, command and event dedupe, timer claims, a linearizable in-memory
  adapter, retention hooks, and the opt-in `createDurableRun` /
  `resumeDurableRun` host integration. The host is at-least-once and makes no
  exactly-once task guarantee; normal `createRun` and core `Store` remain
  single-owner APIs.
- Add `createHostRegistry` for same-key open sharing, generation-safe
  invalidation, expected-value eviction, and abortable disposal with a typed
  disposed result.

### Patch Changes

- Replay completed command and event retries from their stored original result
  and version before rejecting stale expected versions. New IDs now check the
  expected version atomically with dedupe claim creation.
- Updated dependencies
- Updated dependencies
- Updated dependencies [0a488d0]
  - @openwizard/core@0.1.0-next.0

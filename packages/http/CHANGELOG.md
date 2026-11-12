# @openwizard/http

## 0.1.0-next.1

### Minor Changes

- 13cfc63: `@openwizard/webhooks` is now `@openwizard/http` (entries `.`, `./client`, `./nitro`; `./sse` folded
  into `./client`). One assembler serves a wizard over HTTP from any `Request → Response` runtime:
  
  - `createHTTP(wizard, { runs, auth, access, projection?, receive?, idempotency?, cors?, onError? })`
    returns `{ fetch(request), openAPI(info) }`. `runs`, `auth` and `access` turn the run API on
    together; access is deny-by-default (an empty `access` throws). Routes: `POST /api/<id>` (create),
    `GET /:runId`, `GET /:runId/steps/:step`, `GET /:runId/stream` (SSE frames),
    `POST /:runId/commands`, `POST /:runId/events/<event>`, and the Mirror wire `POST /:runId/stream`.
    `runs.get(lookup)` receives `{ request, tenantId, principal, runId }`.
  - `combineHTTP(sources, { cors? })` serves several `createHTTP` results and subscriptions as one
    handler and one OpenAPI document; duplicate routes, operation ids and conflicting schemas throw at
    startup. `OPTIONS` answers CORS preflight when `cors` allows the origin.
  - Idempotency: the `Idempotency-Key` is scoped per API, tenant, run and route and claimed only
    after the run is found. A repeat replays the run's first answer, refusals included. A throw or a
    refusal the run never recorded releases the key, so the retry reaches the run: a durable host's
    lease or dedupe gate, a disposed run (`503 RUN_UNAVAILABLE`), or an event sent before `start()`
    (`409 RUN_NOT_STARTED`, with `Retry-After`). The run dedupes on a
    SHA-256 of the scoped key (the event id; on a durable host also the command id, with a body
    digest), so one key on two routes, APIs or receivers never collides, across processes too. A
    durable command whose worker stopped mid-apply answers `409 IDEMPOTENCY_INTERRUPTED`: read the
    run and retry with a new key.
  - The stream route's `Frame` component is a `oneOf` of the snapshot frame and the transient
    `progress` frame (a hook's `progress(value)`, sent when the projection exposes that step's
    progress). Only snapshot frames set the SSE `id`.
  - Signed receivers: `receive: { events, secret, resolve, correlationId?, path?, toleranceSeconds?,
    maxBodyBytes? }` lists the receivable events explicitly; `secret` may be a list (rotation) or a
    selector; the `webhook-id`, hashed with the receiver id, is the event id. Success is
    `200 { ok, data: { delivered, buffered, seq, duplicate? } }`.
  - `maxBodyBytes` (API default 64 KiB, receivers 1 MiB) is counted while the body streams in: an
    oversized upload is cancelled and answered 413, with or without `Content-Length`.
  - A durable host (`@openwizard/durable`) returned from `runs.get` or `resolve` is used through its
    lease and dedupe gates; its boundary rejection answers 422 and a busy host 503.
  - `createWebhookSubscriptions({ id, events, store, auth, ... })` publishes only the declared public
    events (the form that forwarded run events and its `'inherit'` of internal machine events are removed); routes
    live under `/subscriptions/<id>`; create and rotate answer `{ ok, data: { ...subscription, secret } }`.
    Deliveries are signed with `signWebhook` (Web Crypto; no `standardwebhooks` dependency).
  - OpenAPI 3.1: named components from the wizard's schemas (`<Id>Input`, `<Id><Event>Payload`,
    `<Id><View>Draft`, `<Id>Run`), discriminated command and step unions, tags and Fern groups per
    source (`<id>`, `<id>.webhooks`, `<id>.subscriptions`), operation ids `<id><Method>`, and the
    public outbound events in the `webhooks` section. The Mirror wire POST is not documented.
  - `@openwizard/http/client`: `httpTransport(url, { fetch?, headers? })` is a Mirror `Transport` over
    the stream route, so `createMirror<typeof projection>({ transport })` is a typed browser client
    without code generation; `decodeServerSentEvents` moved here.
  - `@openwizard/http/nitro`: `withNitro(config, { http, source, openAPI? })` mounts every generated
    path on `http.fetch` and serves the document. `withNitroAPI` and `withNitroWebhooks` are removed.
  - Removed: `defineRunAPI`, `defineWebhook`, `defineWebhooks`, `defineHTTPResources`,
    `defineOutboundEvents`, the run-event form of `createWebhookSubscriptions` (`attach`, `RunWebhook*`),
    `createHTTP`'s nested `api` / `outbound` options, `mirrorHandler`.
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
- 13cfc63: Accept the wizard itself in `createHTTP`, type run handles as `Run`, and expose the served definition as `http.wizard`. Rename command capabilities and OpenAPI variants to `startStep` and `startReady`.
  
  Retrying an optimistic Mirror command now replays its recorded response before sequence validation. Durable command receipts also replay across HTTP processes with separate response stores; changing the wire request under the same command id remains an idempotency conflict.
  
  Validate optimistic sequence expectations at the interpreter's atomic dispatch point after asynchronous event parsing. Concurrent REST requests, background work, and cancellation now invalidate stale wire requests without blocking other mutations.
  
  Describe optional retry context patches in OpenAPI, discriminate stream frames by `kind`, and release streamed request readers after completion or size-limit cancellation.
  
  Fence idempotency completion and release by the successful claim's fresh `claimId`. `IdempotencyStore.complete(key, claimId, response)` and `release(key, claimId)` now return a boolean and must atomically compare the current pending owner. Expired or evicted requests cannot overwrite or remove newer replay records.
  
  Wire acknowledgements read the current durable handle generation after dispatch, including when a terminal handle reopens while awaiting an external idempotency store.
  
  HTTP reads and Mirror streams accept a module's base-wizard projection when its host supplies dependencies through `provide()`. Separately authored definitions with the same name and shape remain incompatible.

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

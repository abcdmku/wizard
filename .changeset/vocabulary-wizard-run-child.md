---
'@openwizard/core': minor
'@openwizard/react': minor
'@openwizard/devtools': minor
'@openwizard/durable': minor
'@openwizard/http': minor
'@openwizard/opentelemetry': minor
---

Use one vocabulary. The word "flow" is gone from the public API, the messages and the docs.

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

# v3 Rebuild Plan (`core` + `react`)

Reference specs:
- `v3-orchestrator-council-spec.md`
- `v3-streamlined-api-rfc.md`

## Reality Check

The previous plan correctly covered a linear wizard runtime. It did not cover the full target scope (Wizard + DAG + Saga + hybrid + durability). This rebuild plan updates the sequence to match full scope.

## Phase 1: Core Contracts + Type Tests

Deliverables:
- finalize `StepDefinition`, `OrchestratorState`, `OrchestratorRuntime`
- unify extraction helpers:
  - `StepId<TSteps>`
  - `StepInputMap<TSteps>`
  - `StepOutputMap<TSteps>`
  - `StepErrorMap<TSteps>`
- finalize first-class persistence contracts:
  - `PersistenceConfig`
  - `PersistenceRuntimeState`
  - runtime methods: `loadPersisted/savePersisted/clearPersisted`
- add compile-time tests for:
  - per-step input/output/error inference
  - `next` target safety
  - `dependsOn` safety

Exit criteria:
- all core type tests pass
- no exported API type requires `any`

## Phase 2: Runtime Store + Wizard Navigation

Deliverables:
- immutable state store + event emitter
- persistence controller wired into runtime lifecycle:
  - `autoLoad`
  - `autoSave`
  - `clearOnFinal`
- deterministic wizard transition pipeline:
  1. validate current
  2. run `canExit`
  3. resolve target
  4. run target `canEnter`
  5. run current `exit`
  6. run target `enter`
  7. commit state/event
- implement `go`, `next`, `back`, `canGo`, `reset`

Exit criteria:
- runtime tests pass for linear + branching wizard flows
- async guard behavior deterministic

## Phase 3: DAG Scheduler

Deliverables:
- readiness derivation from `dependsOn` + step status
- implement `runReady({ concurrency })` and `runStep(step)`
- status lifecycle: `idle -> ready -> running -> succeeded/failed`
- retries/timeouts/idempotency policy plumbing

Exit criteria:
- tests cover split/join DAGs, concurrency limits, retry behavior

## Phase 4: Saga Compensation Engine

Deliverables:
- compensation stack tracking (reverse completion order)
- `compensate({ from?, reason? })`
- failure policy handling (`best-effort` default)
- event history for rollback traceability

Exit criteria:
- compensation order is deterministic
- tests cover partial compensation failures

## Phase 5: Persistence + Resume

Deliverables:
- runtime snapshot model
- `snapshot()` and `resume(snapshot)`
- persistence adapter interface (`load/save/clear`)
- persistence runtime methods (`loadPersisted/savePersisted/clearPersisted`)

Exit criteria:
- snapshot/resume round-trip tests pass
- server-mode flows can recover from process restart

## Phase 6: React Binding Layer

Deliverables:
- implement `bindOrchestratorReact`
- expose bound hooks:
  - `useState`
  - `useCurrent`
  - `useStep`
  - `useError`
  - `useActions`
  - `useSelector`
- no overload APIs that branch by argument shape

Exit criteria:
- React type tests pass with literal-step inference
- rerender tests pass with selector-based subscriptions

## Phase 7: Canary Examples

Deliverables:
- client-heavy wizard example
- hybrid checkout example (wizard + server actions)
- server DAG+saga example with durable resume

Exit criteria:
- examples build and typecheck
- examples use only canonical v3 API

## Phase 8: Docs + Migration

Deliverables:
- package root exports cleaned
- migration guide from linear v3 draft
- one canonical docs path

Exit criteria:
- no dual runtime stacks
- no conflicting docs paths

## Test Matrix (Required)

Core unit tests:
- wizard navigation behavior
- DAG scheduler behavior
- saga compensation behavior
- snapshot/resume behavior

Core type tests:
- inference contracts
- transition/dependency target safety
- public API generics

React unit tests:
- bound hooks
- actions integration
- selector rerender behavior

React type tests:
- step-specific inference
- hook typing fidelity

CI gates:
- unit tests
- type tests
- example build + typecheck

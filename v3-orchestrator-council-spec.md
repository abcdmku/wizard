# v3 Orchestrator Council Spec

Date: February 26, 2026

## 1) Quick Audit Of Current Files

Current files are coherent for a typed, linear wizard runtime:
- `v3-rebuild-plan.md`
- `v3-streamlined-api-rfc.md`
- `core-contracts.ts`
- `react-contracts.ts`

What is strong already:
- inference-first direction is clear
- deterministic transition pipeline exists
- React binding direction (bound hooks) is good

What is missing for "Wizard + DAG + Saga orchestrator":
- explicit DAG scheduling model (ready/running/completed/blocked)
- saga compensation semantics and rollback order guarantees
- durable execution model for server workloads (snapshot + resume)
- concurrency controls and idempotency boundaries
- unified API that supports both user-driven navigation and auto-executed tasks

## 2) Architecture Council (Persona-Style Debate)

The following council is a structured design simulation with distinct engineering priorities.

Participants:
- Product/UX Architect: prioritizes predictable user flows and easy composition in apps.
- Distributed Systems Architect: prioritizes durability, retries, idempotency, compensation.
- Fullstack DX Architect (T3-style perspective): prioritizes practical APIs, fast shipping, and clean type inference.
- State/Dataflow Architect (TanStack-style perspective): prioritizes explicit state transitions, selectors, and cache-friendly subscriptions.
- Performance/Tooling Architect (Prime-style perspective): prioritizes simplicity, speed, minimal magic, debuggability.
- Platform Reliability Architect: prioritizes observability, failure domains, and safe operational behavior.

### Debate Round 1: One Engine vs Separate Wizard/DAG/Saga Engines

Positions:
- UX + DX: one engine with modes, avoid fragmented APIs.
- Distributed + Reliability: one engine is acceptable only if semantics are explicit and testable per mode.
- Performance: avoid abstraction bloat; keep core primitive set small.

Decision:
- Build one core orchestrator with explicit execution mode:
  - `wizard`: user-directed transitions (`next`, `go`, `back`)
  - `dag`: scheduler executes ready nodes (`runReady`, `runStep`)
  - `saga`: same as dag/wizard plus compensation stack
  - `hybrid`: combines wizard checkpoints with auto action nodes

### Debate Round 2: API Shape

Positions:
- DX: authoring should be one `defineSteps` + `createOrchestrator` path.
- State/Dataflow: runtime must expose normalized `state.steps` map and subscription hooks.
- Performance: keep builders thin; avoid hidden runtime branching.

Decision:
- Canonical API surface:
  - `step(...)`
  - `defineSteps(...)`
  - `defineFlow(...)`
  - `createOrchestrator(...)`
- Keep `createWizard(...)` as a compatibility alias for `mode: 'wizard'`.

### Debate Round 3: Compensation & Failure Semantics

Positions:
- Distributed: successful side-effecting steps must register compensation intent.
- Reliability: compensation order must be deterministic (reverse completion order by default).
- UX: failure state should be inspectable and resumable.

Decision:
- Saga behavior:
  - push completed compensatable steps onto saga stack
  - on non-recoverable failure, enter `compensating` status
  - compensate in reverse completion order unless custom policy is provided
  - persist event history for replay/debugging

### Debate Round 4: Frontend + Server Runtime Split

Positions:
- UX: client-only steps should not require server infrastructure.
- Distributed: server-only action steps need persistence/retry policies.
- DX: one type system for both, runtime adapters per environment.

Decision:
- `runtime: 'client' | 'server' | 'either'` per step
- pluggable storage adapter for durable server flows
- React binding consumes orchestrator runtime, not step definitions

## 3) Final v3 Decisions

1. Single orchestrator runtime with explicit mode semantics.
2. Step model supports both view steps and action steps.
3. DAG readiness is first-class (`dependsOn` + scheduler methods).
4. Saga compensation is first-class (`compensate` + stack tracking).
5. Durable persistence is first-class (`persistence` flow config + runtime persistence API).
6. React integration is bound API only, no overload-heavy global hooks.

## 4) Proposed Core API (Canonical)

```ts
import {
  createOrchestrator,
  defineFlow,
  defineSteps,
  final,
  action,
  view,
} from '@wizard/core';

type Ctx = {
  cartId: string;
  locale: 'en' | 'fr';
  userId?: string;
};

const steps = defineSteps({
  account: view({
    runtime: 'client',
    initial: { email: '' },
    validate: ({ data }) => {
      if (!data.email.includes('@')) throw new Error('Invalid email');
    },
    next: 'shipping',
  }),
  shipping: view({
    runtime: 'client',
    dependsOn: ['account'],
    initial: { address: '' },
    next: ['reserveInventory', 'calculateTax'],
  }),
  reserveInventory: action({
    runtime: 'server',
    dependsOn: ['shipping'],
    run: async ({ context }) => {
      return { reservationId: `res-${context.cartId}` };
    },
    compensate: async ({ output }) => {
      if (output?.reservationId) {
        // release reservation
      }
    },
    next: 'chargePayment',
  }),
  calculateTax: action({
    runtime: 'server',
    dependsOn: ['shipping'],
    run: async () => ({ tax: 12.5 }),
    next: 'chargePayment',
  }),
  chargePayment: action({
    runtime: 'server',
    dependsOn: ['reserveInventory', 'calculateTax'],
    run: async () => ({ paymentId: 'pay_123' }),
    compensate: async ({ output }) => {
      if (output?.paymentId) {
        // refund payment
      }
    },
    next: 'review',
  }),
  review: final({
    runtime: 'client',
    dependsOn: ['chargePayment'],
    initial: { accepted: false },
    next: null,
  }),
});

const flow = defineFlow({
  mode: 'hybrid',
  context: { cartId: 'cart_1', locale: 'en' } satisfies Ctx,
  start: 'account',
  steps,
  final: ['review'],
  maxConcurrency: 4,
  persistence: {
    adapter: {
      load: async () => null,
      save: async () => {},
      clear: async () => {},
    },
    key: 'wizard:checkout:cart_1',
    autoLoad: true,
    autoSave: 'on-change',
    clearOnFinal: true,
  },
});

const orchestrator = createOrchestrator(flow);
```

## 5) Runtime Contract (Required)

Read/query:
- `current()`
- `context()`
- `step(stepId)`
- `input(stepId)`
- `output(stepId)`
- `error(stepId)`

Mutation/navigation:
- `setInput(stepId, value)`
- `patchInput(stepId, patch)`
- `updateContext(fn)`
- `go(stepId)`
- `next()`
- `back()`

Scheduling/operations:
- `runReady({ concurrency? })`
- `runStep(stepId)`
- `retry(stepId)`
- `compensate({ from?, reason? })`

Durability/observability:
- `snapshot()`
- `resume(snapshot)`
- `loadPersisted()`
- `savePersisted()`
- `clearPersisted()`
- `subscribe(listener)`
- `subscribeEvents(listener)`

Authoring helpers:
- `step(...)`
- `view(...)`
- `action(...)`
- `gate(...)`
- `final(...)`
- `defineSteps(...)`

## 6) Deterministic Transition + Execution Rules

Wizard transition pipeline:
1. validate current
2. current `canExit`
3. resolve target (`go/next`)
4. target `canEnter`
5. current `exit`
6. target `enter`
7. commit state + history event

DAG scheduler pipeline:
1. derive ready set from `dependsOn` + status map
2. pick executable steps by runtime + concurrency budget
3. execute `run`
4. persist output/status
5. resolve `next` edges
6. enqueue newly-ready steps

Saga failure pipeline:
1. mark failed step
2. if mode supports saga, enter `compensating`
3. execute compensation in reverse completion order
4. emit compensation events
5. settle as `failed` or `cancelled` depending on policy

## 7) Frontend Binding Contract

React package (`@wizard/react`) should bind to an orchestrator instance:
- `bindOrchestratorReact(orchestrator)`
- `Provider`
- `useState`
- `useCurrent`
- `useStep(stepId)`
- `useActions`
- `useSelector(selector)` (for rerender control)

No overload-by-argument-shape APIs.

## 8) Large Flow Organization (Required)

Split step definitions by bounded context and compose once with object merge:

```ts
// steps/account.module.ts
import { view } from '@wizard/core';

export const accountSteps = {
  account: view({
    runtime: 'client',
    initial: { email: '' },
    next: 'shipping',
  }),
};

// steps/ops.module.ts
import { action } from '@wizard/core';

export const opsSteps = {
  reserveInventory: action({
    runtime: 'server',
    dependsOn: ['shipping'],
    run: async () => ({ reservationId: 'res_1' }),
    next: 'review',
  }),
};

// steps/index.ts
import { defineSteps } from '@wizard/core';
import { accountSteps } from './account.module';
import { opsSteps } from './ops.module';

export const steps = defineSteps({
  ...accountSteps,
  ...opsSteps,
});
```
## 9) Build Plan (Revised)

Phase 1: Type system and contract stabilization
- finalize core contracts for Wizard/DAG/Saga/hybrid
- add type tests for input/output/error inference and transition safety

Phase 2: Core runtime skeleton
- state store, event bus, immutable state transitions
- wizard navigation (`go`, `next`, `back`)

Phase 3: DAG scheduler
- readiness graph, concurrency guard, run lifecycle
- retries + timeout handling + idempotency hooks

Phase 4: Saga engine
- compensation stack tracking
- rollback orchestration and failure policies

Phase 5: Durability adapters
- in-memory adapter
- server persistence adapter (`load/save/clear`)

Phase 6: React binding
- bound hooks + selector subscriptions
- rerender and suspense-safe tests

Phase 7: Canary examples
- form wizard (client-heavy)
- order pipeline (hybrid)
- server workflow (dag+saga)

Phase 8: migration + docs
- upgrade guide from linear v3 draft
- canonical docs and examples

## 10) Test Matrix (Required)

Core runtime tests:
- linear wizard transitions
- branching and guarded transitions
- DAG joins/splits and concurrency limits
- saga compensation order and partial-compensation failures
- snapshot/resume correctness

Core type tests:
- per-step input/output/error inference
- `next` target safety
- `dependsOn` safety
- runtime method typing (no `any` on public APIs)

React tests:
- bound hook inference
- targeted rerender behavior via selectors
- runtime APIs (`next/go/runStep`) in component contexts

## 11) Guardrails

- Zero compatibility branches in core execution logic.
- One canonical authoring path and one canonical runtime shape.
- No hidden network calls in core package.
- No dual state stores between core and React bindings.

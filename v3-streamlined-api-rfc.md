# RFC: Unified `@wizard/core` + `@wizard/react` Orchestrator v3

Status: Draft
Date: February 26, 2026
Reference: `v3-orchestrator-council-spec.md`

## Objective

Ship a single, inference-first orchestrator that supports:
- wizard navigation flows
- DAG action orchestration
- saga compensation semantics
- hybrid flows mixing UI and server steps

The old linear wizard-only model is treated as a subset of this model.

## Non-Goals

- Distributed queue implementation inside core package
- Hidden or unconfigurable persistence logic in runtime internals
- Multiple incompatible authoring syntaxes

## Core Principles

1. One state model and one runtime contract.
2. One type inference path from `step()/view()/action()/gate()/final()` and `defineSteps()`.
3. Explicit execution semantics per mode (`wizard`, `dag`, `saga`, `hybrid`).
4. Deterministic transition and compensation ordering.
5. Persistence is a first-class flow capability, not an add-on helper.
6. Runtime adapters for environment concerns (client/server/durable storage).

## Canonical Authoring API

```ts
import {
  createOrchestrator,
  defineFlow,
  defineSteps,
  action,
  view,
} from '@wizard/core';

const steps = defineSteps({
  start: view({ runtime: 'client', initial: { email: '' }, next: 'submit' }),
  submit: action({
    runtime: 'server',
    dependsOn: ['start'],
    run: async ({ input }) => ({ ok: true, email: input?.email ?? '' }),
    compensate: async () => {},
    next: null,
  }),
});

const flow = defineFlow({
  mode: 'hybrid',
  context: { locale: 'en' as const },
  start: 'start',
  steps,
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

## Runtime API (Required)

Query methods:
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
- `canGo(stepId)`
- `go(stepId)`
- `next()`
- `back()`

Execution:
- `runReady({ concurrency? })`
- `runStep(stepId)`
- `retry(stepId)`
- `compensate({ from?, reason? })`

Lifecycle:
- `snapshot()`
- `resume(snapshot)`
- `loadPersisted()`
- `savePersisted()`
- `clearPersisted()`
- `reset({ hard? })`
- `subscribe(listener)`
- `subscribeEvents(listener)`

## State Model (Required)

`state` includes:
- `mode`
- `status`
- `current`
- `active`
- `context`
- `steps` (normalized map with status/input/output/error)
- `history` (event log)
- `saga` (stack + compensated list)
- `persistence` (status, autosave mode, last load/save timestamps, last error)
- `isTransitioning`
- `version`

## Step Contract (Required)

Each step may define:
- identity/config: `kind`, `runtime`, `durability`, `meta`
- graph behavior: `dependsOn`, `next`
- navigation hooks: `canEnter`, `canExit`, `enter`, `exit`, `validate`
- execution behavior: `run`, `retry`, `timeoutMs`, `idempotencyKey`
- compensation behavior: `compensate`

## React Contract

React should expose only bound APIs:
- `bindOrchestratorReact(orchestrator)`
- `Provider`
- `useState`
- `useCurrent`
- `useStep`
- `useError`
- `useActions`
- `useSelector`

No runtime-overload branching based on hook arguments.

## Step Kinds

Use these canonical kinds:
- `view` for user-facing progression steps
- `action` for side-effecting or compute steps
- `gate` for branch/control/wait boundaries
- `final` for explicit end-state steps

## Step Modules (Large Flows)

Split steps into modules and compose with object merge:

```ts
import { defineSteps } from '@wizard/core';
import { checkoutSteps } from './steps/checkout.module';
import { paymentSteps } from './steps/payment.module';
import { shippingSteps } from './steps/shipping.module';

export const steps = defineSteps({
  ...checkoutSteps,
  ...paymentSteps,
  ...shippingSteps,
});
```

## Package Layout

- `packages/core`
  - `types.ts`
  - `runtime.ts`
  - `scheduler.ts`
  - `saga.ts`
  - `persistence.ts`
  - `events.ts`
- `packages/react`
  - `bind.tsx`
  - `store.ts`
  - `hooks.ts`

## Acceptance Criteria

- zero `as any` in exported runtime signatures
- deterministic behavior for async guards and transitions
- deterministic compensation order
- full type tests for input/output/error inference
- docs and examples use one canonical API
- linear wizard canary remains supported via compatibility alias

## Open Decisions (To lock in implementation)

1. Should `hybrid` auto-run `action` steps by default, or only via explicit `runReady`?
2. Should compensation stop on first compensation failure or continue best-effort?
3. What should be default retry policy for server runtime steps?
4. Should `autoSave` default to `'off'` or `'on-change'` when persistence is configured?

Current recommendation:
1. explicit `runReady` for predictability
2. continue best-effort, collect compensation errors
3. default retries disabled unless configured
4. default `autoSave` to `'on-change'` with debouncing

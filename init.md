# PRP: Deeply Type-Safe Isomorphic Multi-Step Wizard (with Shared Context)

## High-Level Goal

Create a **deeply type-safe, isomorphic, headless** multi-step wizard library in a **pnpm Nx** monorepo with two packages:

* `@wizard/core` — framework-agnostic Node/Browser core: step graph, transitions/guards, async orchestration, **shared context** across steps, step-local data, events, persistence hooks. Uses **@tanstack/store** for reactive state. Optional Zod adapter for default validation.
* `@wizard/react` — thin React adapter: hooks + provider built on **@tanstack/store**’s React bindings. Optional helpers for TanStack Router v1 + TanStack Start.

Design sensibility should match TanStack libs: **headless, tiny, composable, type-first, SSR-safe, minimal deps**.

## Non-Goals

* No UI components, CSS, or form controls.
* No mandatory router or form lib dependency (provide adapters/examples only).
* No heavyweight FSM libs; simple typed graph/guards in core.

---

## Package & Repo Setup

**Monorepo**

* Tooling: `pnpm`, `nx`, TypeScript project refs, `tsup` for builds (esm + cjs), `vitest` + `uvu` or `vitest` only, `biome` or `eslint+prettier`.
* CI: typecheck, test, lint, size-limit.
* Exports: ESM first (`exports` map), `.d.ts` with strict TS, `sideEffects:false`.

**Packages**

```
/packages/core      (@wizard/core)
/packages/react     (@wizard/react)
/examples/react-router-wizard
/examples/node-saga-wizard
```

---

## Core: API & Types (with Shared Context)

### Type Parameters (single source of truth)

```ts
// C: global shared context across all steps (e.g., user/session/order)
// S: union of step IDs (string literal union)
// D: per-step data map, keyed by S
// E: optional union of event types (for orchestration/eventing)
export type WizardConfig<C, S extends string, D extends Record<S, unknown>, E = never> = {
  initialStep: S;
  initialContext: C;
  steps: {
    [K in S]: StepDefinition<C, S, D[K], E>;
  };
  // optional: global guards, error strategy, persistence, etc.
  onTransition?: (ev: WizardTransitionEvent<C, S, D, E>) => void | Promise<void>;
  persistence?: WizardPersistence<C, S, D>;
};

export type StepDefinition<C, S extends string, Data, E> = {
  // optional schema validator (default adapter is Zod)
  validate?: (data: unknown, ctx: Readonly<C>) => asserts data is Data;
  // allowed next steps (typed). Can be static list or function based on ctx/data
  next:
    | S[]
    | ((args: { ctx: Readonly<C>; data: Readonly<Data> }) => S | readonly S[]);
  // side effects before leaving the step (may update context)
  beforeExit?: (args: {
    ctx: Readonly<C>;
    data: Readonly<Data>;
    updateContext: (updater: (ctx: C) => void) => void;
    emit: (event: E) => void;
  }) => void | Promise<void>;
  // optional async loader for the step (preload, fetch, etc.)
  load?: (args: {
    ctx: Readonly<C>;
    setStepData: (data: Data) => void;
    updateContext: (updater: (ctx: C) => void) => void;
  }) => void | Promise<void>;
  // optional guard to allow entry
  canEnter?: (args: { ctx: Readonly<C> }) => boolean | Promise<boolean>;
  // optional guard to allow leaving
  canExit?: (args: { ctx: Readonly<C>; data: Readonly<Data> }) => boolean | Promise<boolean>;
};

export type WizardState<C, S extends string, D extends Record<S, unknown>> = {
  step: S;
  // global, shared, mutable via `updateContext` in typed way
  context: C;
  // per-step data snapshot map (typed by S)
  data: Partial<D>;
  // last validation error per step (if any)
  errors: Partial<Record<S, unknown>>;
  // history for back/undo/time-travel (configurable)
  history: Array<{ step: S; context: C; data: Partial<D> }>;
};
```

### Core API (headless)

```ts
export type Wizard<C, S extends string, D extends Record<S, unknown>, E> = {
  // reactive store (TanStack Store)
  store: Store<WizardState<C, S, D>>;
  // navigation
  next: (args?: { data?: D[S] }) => Promise<void>;                // validate & go to next (inferred by current step)
  goTo: (step: S, args?: { data?: D[S] }) => Promise<void>;       // jump (honors canEnter/canExit)
  back: () => Promise<void>;                                      // pop history (if enabled)
  reset: () => void;
  // context & data
  updateContext: (updater: (ctx: C) => void) => void;             // typed, mutable draft pattern
  setStepData: (step: S, data: D[S]) => void;
  getContext: () => Readonly<C>;
  getCurrent: () => { step: S; data: Readonly<D[S]> | undefined; ctx: Readonly<C> };
  // events & extensions
  subscribe: (cb: (state: WizardState<C, S, D>) => void) => () => void;
  emit: (event: E) => void;
  // persistence
  snapshot: () => WizardState<C, S, D>;
  restore: (snap: WizardState<C, S, D>) => void;
};

export function createWizard<C, S extends string, D extends Record<S, unknown>, E = never>(
  config: WizardConfig<C, S, D, E>
): Wizard<C, S, D, E>;
```

### Shared Context Semantics

* **Single shared, typed context `C`** lives at the root; **all steps can read it** (`ctx: Readonly<C>`).
* Steps mutate via **`updateContext((ctx) => { ... })`** to keep changes explicit and type-checked.
* **Reducers not required**; rely on tiny mutable-draft callback (implemented safely by copying or shallow clone internally).
* Context is **serializable** by design (document guidance).
* Provide **selectors**: `select((s) => s.context.user.id)` for efficient reads.
* **History snapshots** persist context+data+step for back/undo and resilience (opt-in via config).

### Validation (Zod default, bring-your-own)

* Provide tiny adapter: `createZodValidator(schema)` returning `validate(data, ctx)` that **narrows** `data` to `Data`.
* Do **not** hard-depend on Zod in core; export a small optional utility in `@wizard/core/zod`.

### Guards & Transitions

* `canEnter`/`canExit` allow sync/async preconditions (e.g., auth in ctx).
* `next` computes candidates from `steps[current].next`. If function, its return is type-constrained to `S`/`S[]`.
* On transition: validate -> canExit -> beforeExit -> move -> canEnter -> load.
* If any step fails, surface typed error in `errors[currentStep]` and do not advance.

### Events

* Minimal event bus: `emit(event)`, `onTransition`, `subscribe` to state.
* Events generic `E` keeps core tiny while enabling orchestration.

### Persistence

* Pluggable persistence interface:

```ts
export type WizardPersistence<C,S,D> = {
  save: (state: WizardState<C,S,D>) => void | Promise<void>;
  load?: () => (WizardState<C,S,D> | null | Promise<WizardState<C,S,D> | null>);
};
```

* Example adapters in `/examples`: localStorage, URL (search params), server session.

---

## React Adapter (`@wizard/react`)

### Goals

* Zero logic duplication—thin hooks over the core’s store.
* **SSR/RSC-safe** (no DOM assumptions).
* **No required router**; optional helpers for TanStack Router v1.

### API

```ts
export const WizardProvider: React.FC<{ wizard: Wizard<any, any, any, any> }>;

export function useWizard<
  C, S extends string, D extends Record<S, unknown>, E = never
>(): Wizard<C,S,D,E>; // pulls from context

export function useWizardState<T>(
  selector: (state: WizardState<any, any, any>) => T,
  equals?: (a: T, b: T) => boolean
): T;

// Optional router helpers (peer deps):
export function useSyncWizardWithRouter<S extends string>(
  opts: {
    param: string;          // e.g. "stepId"
    toStep: (param: string) => S | null;
    toUrl: (step: S) => { to: string; search?: Record<string,string> };
  }
): void;
```

---

## Example: Typed Context Shared Across Steps

```ts
// types.ts
import { z } from 'zod';
export type Ctx = { userId?: string; coupon?: string | null; total: number };
export type Steps = 'account' | 'shipping' | 'payment' | 'review';

const shippingSchema = z.object({ address: z.string().min(3) });
const paymentSchema  = z.object({ cardLast4: z.string().length(4) });

export type DataMap = {
  account: { email: string };
  shipping: z.infer<typeof shippingSchema>;
  payment: z.infer<typeof paymentSchema>;
  review: { agreed: boolean };
};

// wizard.ts
import { createWizard, createZodValidator } from '@wizard/core';
import type { Ctx, Steps, DataMap } from './types';

export const wizard = createWizard<Ctx, Steps, DataMap>({
  initialStep: 'account',
  initialContext: { total: 0, coupon: null },
  steps: {
    account: {
      next: ['shipping'],
      beforeExit: ({ updateContext, data }) => {
        // Promote email to shared context, e.g., fetched userId:
        updateContext((ctx) => { ctx.userId = data.email.toLowerCase(); });
      },
    },
    shipping: {
      validate: createZodValidator(shippingSchema),
      next: ['payment'],
      canEnter: ({ ctx }) => Boolean(ctx.userId),
    },
    payment: {
      validate: createZodValidator(paymentSchema),
      next: ({ ctx }) => (ctx.coupon ? ['review'] : ['review']),
      beforeExit: async ({ updateContext, data }) => {
        // add pricing to shared ctx from gateway lookup
        const fee = 2; // pretend fetch
        updateContext((ctx) => { ctx.total = 100 + fee; });
      },
    },
    review: {
      next: [],
    },
  },
  onTransition: (ev) => {
    // analytics, logging
  },
});
```

In React:

```tsx
const App = () => (
  <WizardProvider wizard={wizard}>
    <Routes/>
  </WizardProvider>
);

function ShippingStep() {
  const { getCurrent, next, updateContext } = useWizard<Ctx, Steps, DataMap>();
  const { data, ctx } = getCurrent(); // ctx is the shared context (typed)

  // Use ctx in renders and update when user applies a coupon:
  const applyCoupon = (code: string) => updateContext((c) => { c.coupon = code; });

  const onSubmit = (form: DataMap['shipping']) => next({ data: form });
  // ...
}
```

---

## TanStack Router v1 Integration (Optional)

* `useSyncWizardWithRouter({ param: 'stepId', toStep, toUrl })` keeps URL and wizard in sync.
* Example route `/checkout/$stepId` with param type restricted to `Steps`.
* Guard invalid routes by redirecting to nearest valid step via `canEnter`.

---

## Node/Saga Example (No React)

* Example demonstrates a background “wizard” orchestration that:

  1. loads ctx from DB, 2) reserves inventory, 3) charges, 4) sends email.
* Uses `updateContext` to push orchestrated results into ctx at each step.
* Shows persistence adapter writing snapshots after each transition.

---

## Constraints & Size Budget

* Core runtime deps: `@tanstack/store` only. (Zod adapter is optional/peer.)
* No heavy utilities—implement tiny helpers locally.
* Ensure tree-shakability (`sideEffects:false`, proper `exports`).
* Keep core under \~3-4 kB min+gz if feasible (excluding peer deps).

---

## Deliverables

1. **Monorepo scaffold** (pnpm + nx) with `@wizard/core` and `@wizard/react`.
2. **Core implementation** per API above, including:

   * Typed shared context `C` with `updateContext`.
   * Typed step data map `D`.
   * Guards, validation, transitions, async hooks.
   * Events, snapshots, persistence interface.
3. **React adapter**:

   * `WizardProvider`, `useWizard`, `useWizardState`, router sync helper.
4. **Examples**:

   * `examples/react-router-wizard` (TanStack Router v1 + Start ready).
   * `examples/node-saga-wizard` (CLI or Node script).
5. **Tests**:

   * Type tests ensuring invalid steps/transition/data are compile-time errors.
   * Behavior tests for guards, validate, beforeExit, context updates, history.
6. **Docs**:

   * README with quickstart, API reference, patterns (forms, routing, saga).
   * Size notes, SSR notes, adapter patterns (Zod, persistence).

---

## Implementation Notes

* Use **@tanstack/store** signals; expose `store` on wizard instance.
* Implement `updateContext` as a **mutable draft callback** but copy/commit internally to keep simple and tiny (no immer).
* Provide `select` helpers to avoid over-rendering in React (`useWizardState` with selector).
* Validation path:

  * If step has `validate`, run before `canExit`. Store errors on failure.
  * Zod adapter: narrow type via TS `asserts data is Data`.
* History: keep small ring buffer (configurable) for back/undo; include ctx+data snapshots.
* Ensure the whole core is **SSR safe** (no window/document).
* Publish with proper `exports` and types.

---

## Acceptance Criteria

* TS infers:

  * `wizard.next({ data })` requires the **current step’s** `D[S]` type.
  * `wizard.goTo('payment', { data })` enforces `D['payment']`.
  * `updateContext` exposes strongly typed mutable draft of `C`.
* Invalid step ids and transitions produce **compile-time errors** where applicable.
* Shared context updates are visible in subsequent steps and in router redirects/guards.
* React example works with TanStack Router v1 + Start, including deep linking/back.
* Node example runs end-to-end (no React) and persists snapshots.

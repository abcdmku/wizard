# PRP: Isomorphic, Deeply-Typed Wizard — Core + React + Inference + Helpers + Docs

## High-Level Goals

* REFACTOR CURRENT CODE STRUCTURE TO MATCH WHATS DEFINED HERE
* Monorepo with **core** (isomorphic/headless) and **react** adapter.
* Nextra docs: pages for helpers + inference patterns, embedding examples.

## Repo Layout

```
/packages/core           @wizard/core
/packages/react          @wizard/react
/packages/docs           @wizard/docs (Nextra)
```

---

## Core Package (@wizard/core)

### 1) refactor or add Utility Types (server-safe + tiny resolvers)

```ts
export type JSONValue =
  | string | number | boolean | null
  | { [k: string]: JSONValue }
  | JSONValue[];

export type ValOrFn<T, A> = T | ((args: A) => T);

export const resolve = <T, A>(v: ValOrFn<T, A>, a: A): T =>
  typeof v === 'function' ? (v as any)(a) : v;
```

### 2) Callback Args (use *inferred* Data)

```ts
export type StepArgs<C, S extends string, Data, E> = {
  step: S;
  ctx: Readonly<C>;
  data: Readonly<Data> | undefined;
  updateContext: (fn: (ctx: C) => void) => void;
  setStepData: (data: Data) => void;
  emit: (event: E) => void;
};

export type StepEnterArgs<C, S extends string, Data, E> =
  StepArgs<C, S, Data, E> & { from?: S | null };

export type StepExitArgs<C, S extends string, Data, E> =
  StepArgs<C, S, Data, E> & { to?: S | null };

export type ValidateArgs<C> = {
  ctx: Readonly<C>;
  data: unknown; // to be narrowed by validate
};
```

### 3) Server-Safe Meta (core) + Resolver

```ts
export type StepMetaCore<C, S extends string, Data, E> = {
  id?: string;
  label?: ValOrFn<string, StepArgs<C,S,Data,E>>;
  shortLabel?: ValOrFn<string, StepArgs<C,S,Data,E>>;
  description?: ValOrFn<string, StepArgs<C,S,Data,E>>;
  tooltip?: ValOrFn<string, StepArgs<C,S,Data,E>>;
  iconKey?: ValOrFn<string, StepArgs<C,S,Data,E>>;
  category?: ValOrFn<string, StepArgs<C,S,Data,E>>;
  tags?: ValOrFn<readonly string[], StepArgs<C,S,Data,E>>;
  hidden?: ValOrFn<boolean, StepArgs<C,S,Data,E>>;
  docsUrl?: string;
  ariaLabel?: ValOrFn<string, StepArgs<C,S,Data,E>>;
  extra?: Record<string, JSONValue>;
};

export function resolveMetaCore<C,S extends string,Data,E>(
  meta: StepMetaCore<C,S,Data,E> | undefined,
  args: StepArgs<C,S,Data,E>
) {
  const r = <T>(v: ValOrFn<T, typeof args> | undefined, d: T): T =>
    (typeof v === 'function' ? (v as any)(args) : (v ?? d));
  return {
    id: meta?.id ?? args.step,
    label: r(meta?.label, args.step),
    shortLabel: r(meta?.shortLabel, r(meta?.label, args.step)),
    description: r(meta?.description, ''),
    tooltip: r(meta?.tooltip, ''),
    iconKey: r(meta?.iconKey, ''),
    category: r(meta?.category, ''),
    tags: r(meta?.tags as any, [] as string[]),
    hidden: r(meta?.hidden as any, false),
    docsUrl: meta?.docsUrl ?? '',
    ariaLabel: r(meta?.ariaLabel, r(meta?.label, args.step)),
    extra: meta?.extra ?? {},
  };
}
```

### 4) Status Vocabulary

```ts
export type StepStatus =
  | 'unavailable'  // guards/prereqs fail
  | 'optional'     // meta classification
  | 'current'      // active
  | 'completed'    // success
  | 'required'     // meta classification
  | 'skipped'      // intentionally bypassed
  | 'error'        // retryable failure
  | 'terminated'   // terminal failure
  | 'loading';     // async in progress
```

### 5) Step Definition (value-or-fn, typed via inference)

```ts
export type StepDefinition<C,S extends string,Data,E = never> = {
  next: readonly S[] | ((args: StepArgs<C,S,Data,E>) => S | readonly S[]);
  data?: ValOrFn<Data, StepEnterArgs<C,S,Data,E>>;

  beforeEnter?: (
    args: StepEnterArgs<C,S,Data,E>
  ) => void | Partial<Data> | Data | Promise<void | Partial<Data> | Data>;

  validate?: (args: ValidateArgs<C>) => asserts args.data is Data;

  complete?: ValOrFn<boolean, StepArgs<C,S,Data,E>>;
  canEnter?: ValOrFn<boolean, StepEnterArgs<C,S,Data,E>>;
  canExit?: ValOrFn<boolean, StepExitArgs<C,S,Data,E>>;

  beforeExit?: (args: StepExitArgs<C,S,Data,E>) => void | Promise<void>;

  weight?: ValOrFn<number, StepArgs<C,S,Data,E>>;
  required?: ValOrFn<boolean, StepArgs<C,S,Data,E>>;
  maxRetries?: ValOrFn<number, StepArgs<C,S,Data,E>>;
  retryDelay?: ValOrFn<number, StepArgs<C,S,Data,E>>; // ms

  meta?: StepMetaCore<C,S,Data,E>;
};
```

### 6) Inference Engine (defineSteps → infer Data per step)

```ts
// Infer Data from validate() → beforeEnter() return → data initializer
type InferFromValidate<TDef> =
  TDef extends { validate: (a: infer A) => any }
    ? A extends { data: infer D } ? D : never : never;

type InferFromBeforeEnter<TDef> =
  TDef extends { beforeEnter: (...a: any[]) => infer R | Promise<infer R> }
    ? (R extends void ? never : R) : never;

type InferFromData<TDef> =
  TDef extends { data: infer D } ? (D extends ValOrFn<infer X, any> ? X : D) : never;

type OrNeverToUnknown<T> = [T] extends [never] ? unknown : T;

export type InferStepData<TDef> = OrNeverToUnknown<
  InferFromValidate<TDef> | InferFromBeforeEnter<TDef> | InferFromData<TDef>
>;

// Authoring surface (callbacks see inferred Data)
export type PartialStepDefinition<C,S extends string,E,TDef> = {
  next: readonly S[] | ((args: StepArgs<C,S,InferStepData<TDef>,E>) => S | readonly S[]);
  data?: ValOrFn<InferStepData<TDef>, StepEnterArgs<C,S,InferStepData<TDef>,E>>;
  beforeEnter?: (
    args: StepEnterArgs<C,S,InferStepData<TDef>,E>
  ) => void | Partial<InferStepData<TDef>> | InferStepData<TDef> | Promise<void | Partial<InferStepData<TDef>> | InferStepData<TDef>>;
  validate?: (args: ValidateArgs<C>) => asserts args.data is InferStepData<TDef>;
  complete?: ValOrFn<boolean, StepArgs<C,S,InferStepData<TDef>,E>>;
  canEnter?: ValOrFn<boolean, StepEnterArgs<C,S,InferStepData<TDef>,E>>;
  canExit?: ValOrFn<boolean, StepExitArgs<C,S,InferStepData<TDef>,E>>;
  beforeExit?: (args: StepExitArgs<C,S,InferStepData<TDef>,E>) => void | Promise<void>;
  weight?: ValOrFn<number, StepArgs<C,S,InferStepData<TDef>,E>>;
  required?: ValOrFn<boolean, StepArgs<C,S,InferStepData<TDef>,E>>;
  maxRetries?: ValOrFn<number, StepArgs<C,S,InferStepData<TDef>,E>>;
  retryDelay?: ValOrFn<number, StepArgs<C,S,InferStepData<TDef>,E>>;
  meta?: StepMetaCore<C,S,InferStepData<TDef>,E>;
};

export type StepIds<T> = keyof T & string;
export type DataMapFromDefs<TDefs> = { [K in keyof TDefs & string]: InferStepData<TDefs[K]> };

export function defineSteps<C, E, T extends Record<string, any>>(defs: T) {
  return defs as T; // runtime normalization in factory; typing leverages T
}
```

### 7) Wizard State + Store + Helpers

```ts
import { Store } from '@tanstack/store';

export type WizardState<C,S extends string,D extends Record<S, unknown>> = {
  step: S;
  context: C;
  data: Partial<D>;
  errors: Partial<Record<S, unknown>>;
  history: Array<{ step: S; context: C; data: Partial<D> }>;
  runtime?: Partial<Record<S, {
    status?: StepStatus; attempts?: number; startedAt?: number; finishedAt?: number;
  }>>;
};

export type WizardHelpers<C,S extends string,D extends Record<S,unknown>> = {
  allSteps(): readonly S[];
  orderedSteps(): readonly S[];
  stepCount(): number;
  stepIndex(step: S): number;
  currentIndex(): number;

  stepStatus(step: S): StepStatus;
  isOptional(step: S): boolean;
  isRequired(step: S): boolean;

  availableSteps(): readonly S[];
  unavailableSteps(): readonly S[];
  refreshAvailability(): Promise<void>;

  completedSteps(): readonly S[];
  remainingSteps(): readonly S[];
  firstIncompleteStep(): S | null;
  lastCompletedStep(): S | null;
  remainingRequiredCount(): number;
  isComplete(): boolean;
  progress(): { ratio: number; percent: number; label: string };

  canGoNext(): boolean;
  canGoBack(): boolean;
  canGoTo(step: S): boolean;
  findNextAvailable(from?: S): S | null;
  findPrevAvailable(from?: S): S | null;
  jumpToNextRequired(): S | null;

  isReachable(step: S): boolean;
  prerequisitesFor(step: S): readonly S[];
  successorsOf(step: S): readonly S[];

  stepAttempts(step: S): number;
  stepDuration(step: S): number | null;

  percentCompletePerStep(): Record<S, number>;
  snapshot(): WizardState<C,S,D>;
};

export type Wizard<C,S extends string,D extends Record<S, unknown>,E> = {
  store: Store<WizardState<C,S,D>>;
  next(args?: { data?: D[S] }): Promise<void>;
  goTo(step: S, args?: { data?: D[S] }): Promise<void>;
  back(): Promise<void>;
  reset(): void;

  updateContext(fn: (ctx: C) => void): void;
  setStepData(step: S, data: D[S]): void;
  getContext(): Readonly<C>;
  getCurrent(): { step: S; data: Readonly<D[S]> | undefined; ctx: Readonly<C> };

  markError(step: S, err: unknown): void;
  markTerminated(step: S, err?: unknown): void;
  markLoading(step: S): void;
  markIdle(step: S): void;
  markSkipped(step: S): void;

  helpers: WizardHelpers<C,S,D>;
};
```

### 8) Factory: createWizard (keeps inference)

```ts
export function createWizard<C, E, TDefs extends Record<string, any>>(opts: {
  context: C;
  steps: TDefs;                   // from defineSteps()
  order?: readonly (keyof TDefs & string)[];
  onStatusChange?: (a: { step: keyof TDefs & string; prev?: StepStatus; next: StepStatus }) => void;
}) {
  type S = StepIds<TDefs>;
  type D = DataMapFromDefs<TDefs>;
  // Implement store, guards cache, ordering (order → topo → declaration), helpers, transitions.
  return {} as Wizard<C, S, D, E>;
}
```

---

## React Package (@wizard/react)

### 1) UI Meta + Component (value-or-fn) + Resolver

```ts
import * as React from 'react';
import { ValOrFn, StepArgs } from '@wizard/core';

export type ComponentLike = React.ComponentType<any> | React.ReactElement;

export type StepMetaUI<C,S extends string,Data,E> = {
  icon?: ValOrFn<React.ReactNode, StepArgs<C,S,Data,E>>;
  renderBadge?: ValOrFn<React.ReactNode, StepArgs<C,S,Data,E>>;
  uiExtra?: Record<string, unknown>;
};

export function resolveMetaUI<C,S extends string,Data,E>(
  meta: StepMetaUI<C,S,Data,E> | undefined,
  args: StepArgs<C,S,Data,E>
) {
  const r = <T>(v: ValOrFn<T, typeof args> | undefined): T | undefined =>
    typeof v === 'function' ? (v as any)(args) : v;
  return { icon: r(meta?.icon), renderBadge: r(meta?.renderBadge), uiExtra: meta?.uiExtra };
}

export type ReactStepDefinition<C,S extends string,E,TDef> =
  import('@wizard/core').PartialStepDefinition<C,S,E,TDef> & {
    component?: ValOrFn<ComponentLike, StepArgs<C,S,import('@wizard/core').InferStepData<TDef>,E>>;
    uiMeta?: StepMetaUI<C,S,import('@wizard/core').InferStepData<TDef>,E>;
  };

export function resolveStepComponent<C,S extends string,Data,E>(
  comp: ValOrFn<ComponentLike, StepArgs<C,S,Data,E>> | undefined,
  args: StepArgs<C,S,Data,E>
): React.ReactElement | null {
  if (!comp) return null;
  const value = typeof comp === 'function' ? (comp as any)(args) : comp;
  if (React.isValidElement(value)) return value;
  if (typeof value === 'function') return React.createElement(value as React.ComponentType<any>, { args });
  return null;
}
```

### 2) Provider + Hooks

```ts
// WizardProvider(wizard), useWizard(), useWizardState(selector)
// Thin bindings around @tanstack/store + core Wizard type.
```

---

## Helpers & Status Docs (Nextra hooks)

* Add `/content/api/helpers.mdx`: list + detail for each helper: signature, semantics, example, cross-links.
* Include **Status Reference Table** for the 9 statuses + semantics.
* Embed code from examples via a `<CodeFrom path="...">` component (docs utility).
* Pages on **inference-first authoring**: show `validate → beforeEnter → data` priority, hover types.

---

## Examples (must compile)

* `basic-form-wizard`: minimal 3-step with validate/data inference; progress bar using helpers.
* `router-guard-wizard`: TanStack Router v1 sync + `canEnter/canExit` + `unavailable` visuals.
* `advanced-branching`: dynamic next(), `optional/required`, error vs terminated & retry.
* `node-saga-wizard`: CLI/server flow; server-safe meta logging; snapshots/persistence.

---

## Acceptance Criteria

* Author can write:

  ```ts
  const steps = defineSteps<Ctx, Ev>({
    account: {
      validate: ({ data }) => schema.parse(data),
      data: { name:'', email:'' },
      next: () => 'shipping',
      component: ({ data, setStepData }) => <Form .../>,
      meta: { label: 'Account', iconKey: 'user' },
    },
    shipping: { beforeEnter: () => ({ address:'' }), next: () => 'review' },
    review:   { data: { agreed:false }, next: () => 'done' },
    done:     { next: [] },
  });

  const wizard = createWizard({ context: { userId:null }, steps });
  ```

  without generics; **callbacks see correct per-step `data` types.**
* Core meta is **JSON-serializable**; UI meta & `component` live in react pkg.
* Helpers expose all functions listed; status semantics match; progress monotone; availability refresh works.
* Tests: type tests (inference), unit tests (helpers/status/guards), react smoke test.
* Docs render helper/API pages and embed examples.

---

## Build & CI

* Core: `@tanstack/store`, optional Zod adapter (peer/optional).
* `tsup` builds (esm/cjs/types), `strict` TS, `sideEffects:false`.
* Vitest for unit + type tests.
* Size budget checks.

---

## Implementation Notes

* Order resolution: `config.order` → topo from static `next` graph (if acyclic) → declaration order.
* Guard cache + `refreshAvailability()` (debounced).
* Runtime marks for `loading/error/terminated/skipped` optional but supported with `mark*` APIs.
* SSR-safe core (no DOM), React adapter only in `/react`.

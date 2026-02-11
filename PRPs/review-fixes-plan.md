# @wizard Review Fixes — Execution Plan

## Overview

5-agent review scored the library **64/100**. This plan addresses every finding, organized into parallel work streams that can be executed by a team of agents simultaneously.

---

## Work Stream 1: Core Type System Fixes
**Agent**: `type-system-fixer`
**Files**: `packages/core/src/types.ts`, `packages/core/src/step-helpers.ts`, `packages/core/src/wizard-factory.ts`, `packages/core/src/wizard.ts`
**Depends on**: Nothing (can start immediately)

### Task 1.1: Unify Data Inference System
**Problem**: Two competing inference extractors — `InferStepData` (line 149) and `DirectExtractDataType` (line 417) — produce different types for the same step definition. `DataMapFromDefs` uses one, `EnhancedDataMapFromDefs` uses the other.

**Fix**:
- Delete `InferStepData`, `InferFromValidate`, `InferFromBeforeEnter`, `InferFromData` (lines 125-156)
- Delete `DataMapFromDefs` (line 178)
- Rename `EnhancedDataMapFromDefs` → `DataMapFromDefs` (keep as the single extractor)
- Update all imports/references across the codebase
- Update `DirectExtractDataType` priority: `__data` phantom → validate → data property → `unknown`

### Task 1.2: Fix `__data` Phantom Property Bug
**Problem**: `T extends { __data?: infer D }` matches ALL objects because the property is optional. Steps defined without `step()` helper get `unknown` instead of correct inference.

**Fix**:
- Change the phantom from optional to a branded symbol approach:
```typescript
declare const DATA_BRAND: unique symbol;
type WithDataBrand<D> = { [DATA_BRAND]?: D };
```
- Update `DirectExtractDataType` to check for the brand first:
```typescript
type DirectExtractDataType<T> =
  T extends { [DATA_BRAND]?: infer D } ? D  // Only matches branded steps
  : T extends { data?: infer D } ? (D extends (...args: any[]) => infer R ? R : D)
  : T extends { validate: (args: { data: infer D }) => any } ? D
  : unknown;
```
- Update `step()` in `wizard-factory.ts` and `step-helpers.ts` to return `& WithDataBrand<Data>` instead of `& { __data?: Data }`

### Task 1.3: Fix `createWizard` Return Type (eliminate `as ReturnType<...>` casts)
**Problem**: 4/6 examples need `as ReturnType<typeof createWizard<typeof steps>>`. The return type inference breaks when context is involved.

**Fix**:
- The issue is in `wizard.ts:26` — `createWizard` returns `Wizard<C, StepIds<TDefs>, EnhancedDataMapFromDefs<TDefs>, E>`. When `TDefs` comes from a factory's `step()` with phantom types, the extraction works. But when used directly, TDefs loses the phantom and `EnhancedDataMapFromDefs` falls back to `unknown` per step.
- Ensure `createWizard` preserves `const` inference on the `steps` parameter:
```typescript
export function createWizard<C, E, const TDefs extends Record<string, any>>(opts: {
  context: C;
  steps: TDefs;
  // ...
}): Wizard<C, StepIds<TDefs>, DataMapFromDefs<TDefs>, E>
```
- The `const` modifier on `TDefs` preserves literal types through the call, which helps inference.
- Test that after this fix, `createWizard({ context: {}, steps })` returns correctly typed wizard without any casts.

### Task 1.4: Fix Validate Callback Data Typing
**Problem**: In advanced-branching, validate callbacks receive untyped `data` and users must cast `data as typeof initialData.X`. The `defineSteps` overload (types.ts:206-223) attempts to fix this but the mega-conditional types are unreliable.

**Fix**:
- Simplify the `defineSteps` return type. Instead of the massive conditional at lines 206-223, use a mapped type that extracts data per step and threads it through callbacks:
```typescript
export function defineSteps<const T extends Record<string, any>>(defs: T): {
  [K in keyof T]: T[K] & {
    validate?: (args: { context: any; data: DataTypeOf<T[K]> }) => void;
    beforeExit?: (args: { step: K & string; context: any; data: DataTypeOf<T[K]>; to?: string | null; updateContext: any; setStepData: any; emit: any; getAllStepNames: any }) => void | Promise<void>;
    // ... other callbacks with DataTypeOf<T[K]>
  }
}
```
Where `DataTypeOf<T>` is the unified extractor (from Task 1.1).

### Task 1.5: Consolidate Duplicate Types
**Problem**: 4 step definition types, 9 callback arg types, 3 data extractors.

**Fix**:
- Delete `PartialStepDefinition` (types.ts:159-175) — replaced by simplified `defineSteps` return type
- Delete `TypedStepArgs`, `TypedStepEnterArgs`, `TypedStepExitArgs` (types.ts:188-203) — identical to `StepArgs`, `StepEnterArgs`, `StepExitArgs`
- Delete `StepWithData` (types.ts:482-496) — unused helper type
- Delete `ExtractStepDataType` (types.ts:402-411) — unused third extractor
- Move legacy compatibility types (`WizardConfig`, `WizardTransitionEvent`, `InferContext`, `InferSteps`, `InferDataMap`, `StepRuntime`, `WizardPersistence`) to a new file `packages/core/src/legacy-types.ts` and re-export from index

### Task 1.6: Reduce `as any` Casts
**Target**: Reduce from 36 to <12.

Priority casts to fix:
- `wizard.ts:594` — `{ skipBeforeExit: true } as any` → Add `skipBeforeExit?: boolean` to `goTo` internal options type (separate from public type)
- `wizard.ts:564` — `data: currentData as any` in validate → Use proper generic to thread data type
- `step-wrapper.ts` — Replace 16x `this.name as unknown as AllSteps` by simplifying the generic signature: use `AllSteps` directly instead of separate `StepName` parameter where it causes friction
- `types.ts:18` — Document the `resolve` function limitation (T must not be a callable type) with a JSDoc comment. The `as any` here is unavoidable.
- `types.ts:74-75` — `meta?.tags as any`, `meta?.hidden as any` → Fix with proper readonly handling

### Task 1.7: Type the `skipBeforeExit` Option Properly
**Problem**: `wizard.ts:594` passes `{ skipBeforeExit: true } as any` to `goTo()` — undeclared hidden protocol.

**Fix**:
- Create an internal `GoToInternalOptions` type that extends the public options:
```typescript
type GoToInternalOptions<K extends S> = {
  data?: D[K];
  skipBeforeExit?: boolean;
  skipGuards?: boolean;
};
```
- Use this type in the `goTo` implementation while keeping the public `Wizard` type's `goTo` signature clean (without `skipBeforeExit`).

---

## Work Stream 2: React Adapter Fixes
**Agent**: `react-fixer`
**Files**: `packages/react/src/hooks.ts`, `packages/react/src/factory.tsx`, `packages/react/src/context.tsx`, `packages/react/src/router.ts`, `packages/react/src/tanstack-router.tsx`, `packages/react/src/step-wrapper.ts`, `packages/react/src/types.ts`, `packages/react/src/index.ts`
**Depends on**: Work Stream 1 (type changes affect React types)

### Task 2.1: Fix `useWizardProgress` Selector (Always Re-renders)
**Problem**: Object literal selector always produces new reference, defeating shallow equality.

**Fix**:
```typescript
export function useWizardProgress<C, S extends string, D extends Record<S, unknown>, E = never>(
  wizard: Wizard<C, S, D, E>
) {
  const step = useStore(wizard.store, (state) => state.step);
  const historyLength = useStore(wizard.store, (state) => state.history.length);

  const allSteps = wizard.helpers.orderedStepNames();
  const visibleSteps = allSteps; // compute once
  const currentIndex = visibleSteps.indexOf(step);
  const totalSteps = visibleSteps.length;
  const percentage = totalSteps > 0 ? ((currentIndex + 1) / totalSteps) * 100 : 0;

  return {
    currentIndex,
    totalSteps,
    percentage,
    isFirstStep: currentIndex === 0,
    isLastStep: currentIndex === totalSteps - 1,
  };
}
```
Use multiple primitive `useStore` calls instead of one object-returning selector.

### Task 2.2: Fix `useWizardStep` Selector (Same Issue)
**Problem**: Returns `{ data, runtime }` object literal — new ref every time.

**Fix**:
```typescript
export function useWizardStep<C, S extends string, D extends Record<S, unknown>, E = never, K extends S = S>(
  wizard: Wizard<C, S, D, E> & { getStepComponent?: (stepName: S) => any },
  stepName: K
): ReactWizardStep<K, D[K], C, S, D> {
  // Subscribe to specific primitives
  useStore(wizard.store, (state) => state.data[stepName]);
  useStore(wizard.store, (state) => state.runtime?.[stepName]?.status);

  const getComponent = (sn: S) => wizard.getStepComponent?.(sn);
  return wrapWithReactStep(wizard.getStep(stepName), getComponent);
}
```

### Task 2.3: Memoize `.bind()` Calls in `useWizard`
**Problem**: 25+ new function references created per render.

**Fix**: Since the wizard instance is a stable module-level singleton, the bound methods are always the same. Cache them:
```typescript
const methodCache = new WeakMap<Wizard<any, any, any, any>, Record<string, Function>>();

function getBoundMethods<C, S extends string, D extends Record<S, unknown>, E>(wizard: Wizard<C, S, D, E>) {
  if (methodCache.has(wizard)) return methodCache.get(wizard)!;
  const methods = {
    next: wizard.next.bind(wizard),
    back: wizard.back.bind(wizard),
    goTo: wizard.goTo.bind(wizard),
    reset: wizard.reset.bind(wizard),
    updateStepData: wizard.updateStepData.bind(wizard),
    setStepData: wizard.setStepData.bind(wizard),
    getStepData: wizard.getStepData.bind(wizard),
    updateContext: wizard.updateContext.bind(wizard),
    getContext: wizard.getContext.bind(wizard),
    setStepMeta: wizard.setStepMeta.bind(wizard),
    updateStepMeta: wizard.updateStepMeta.bind(wizard),
    getStepMeta: wizard.getStepMeta.bind(wizard),
    getStepError: wizard.getStepError.bind(wizard),
    getAllErrors: wizard.getAllErrors.bind(wizard),
    clearStepError: wizard.clearStepError.bind(wizard),
    clearAllErrors: wizard.clearAllErrors.bind(wizard),
    getStep: wizard.getStep.bind(wizard),
    getCurrentStep: wizard.getCurrentStep.bind(wizard),
    getCurrent: wizard.getCurrent.bind(wizard),
    markError: wizard.markError.bind(wizard),
    markTerminated: wizard.markTerminated.bind(wizard),
    markLoading: wizard.markLoading.bind(wizard),
    markIdle: wizard.markIdle.bind(wizard),
    markSkipped: wizard.markSkipped.bind(wizard),
  };
  methodCache.set(wizard, methods);
  return methods;
}
```
Then in `useWizard`, spread `getBoundMethods(wizard)` instead of individual `.bind()` calls.

### Task 2.4: Resolve WizardProvider Confusion
**Problem**: `WizardProvider` exists but no hooks use it. All hooks take `wizard` as first arg directly.

**Fix**: Add overloads to key hooks so they work BOTH ways:
```typescript
// Overload 1: Direct wizard injection (preferred)
export function useWizard<C, S extends string, D extends Record<S, unknown>, E = never>(
  wizard: Wizard<C, S, D, E>
): UseWizardReturn<C, S, D, E>;

// Overload 2: From context (when using WizardProvider)
export function useWizard<C, S extends string, D extends Record<S, unknown>, E = never>(): UseWizardReturn<C, S, D, E>;

export function useWizard(wizard?: any) {
  const resolved = wizard ?? useWizardContext();
  // ... rest of implementation
}
```
Do this for `useWizard`, `useCurrentStep`, `useWizardStep`, `useWizardProgress`, `useWizardActions`, `useWizardHelpers`, `useStepError`.

### Task 2.5: Standardize `component` Field
**Problem**: `component` is resolved differently by factory (`React.createElement`) vs types.ts (`resolveStepComponent` calls it directly).

**Fix**:
- Define `component` as `React.ComponentType<StepComponentProps<Data, Context>>` (always a component, not a render function)
- Always render via `React.createElement(comp, props)`
- Remove the `ValOrFn` wrapper from the component field
- Update `resolveStepComponent` and factory `getStepComponent` to use consistent resolution

### Task 2.6: Consolidate Router Integrations
**Problem**: `router.ts` and `tanstack-router.tsx` are parallel implementations that don't share code. The TanStack one mutates wizard methods.

**Fix**:
- Delete `tanstack-router.tsx` (it's dangerous — method mutation, `window.location`, `window.history.back()`)
- Keep `router.ts` with `useSyncWizardWithRouter` as the universal adapter
- Create a new `tanstack-router.ts` that wraps `useSyncWizardWithRouter` properly:
```typescript
export function useTanStackWizardRouter<C, S extends string, D extends Record<S, unknown>, E = never>(
  wizard: Wizard<C, S, D, E>,
  options: { basePath: string; paramName?: string }
) {
  const navigate = useNavigate();
  const params = useParams({ strict: false });

  return useSyncWizardWithRouter(wizard, {
    param: options.paramName ?? 'step',
    toStep: (param) => param as S,
    toUrl: (step) => ({ to: `${options.basePath}/${step}` }),
    navigate,
    getParam: () => params[options.paramName ?? 'step'],
  });
}
```
- Remove `createWizardRouteComponent` — it's too opinionated and uses method mutation

### Task 2.7: Remove Redundant Factory APIs
**Problem**: `reactWizardWithContext` has both `builder()` and `defineSteps()` which do the same thing.

**Fix**:
- Remove `builder()` from `reactWizardWithContext` return
- Keep `defineSteps()` + `step()` + `createWizard()` as the consistent pattern
- Rename `createStepBuilder` to just document it as an advanced API in the factory

---

## Work Stream 3: API Surface Cleanup
**Agent**: `api-cleanup`
**Files**: `packages/core/src/index.ts`, `packages/core/src/wizard.ts`, `packages/core/src/step-helpers.ts`, `packages/core/src/wizard-factory.ts`, `packages/core/src/types.ts`, `packages/react/src/index.ts`, `packages/react/src/factory.tsx`
**Depends on**: Work Streams 1 and 2

### Task 3.1: Remove Dead-Weight Step Helpers
Remove from `packages/core/src/step-helpers.ts` and `packages/core/src/index.ts`:
- `dataStep()` — saves 0 lines
- `transitionStep()` — saves 0 lines
- `conditionalStep()` — saves 0 lines

Keep: `step()`, `stepWithValidation()`

### Task 3.2: Remove `wizardWithContext` from Core
**Problem**: Trivial wrapper around `createWizardFactory` + `{ context }`.

**Fix**:
- Remove `wizardWithContext` from `packages/core/src/wizard-factory.ts`
- Remove from `packages/core/src/index.ts` exports
- Update any examples that use it to use `createWizardFactory` directly

### Task 3.3: Eliminate Duplicate Object-Returning Helpers
Remove from `WizardHelpers` type and implementation in `wizard.ts`:
- `allSteps()` → users do `helpers.allStepNames().map(wizard.getStep)`
- `orderedSteps()` → same
- `availableSteps()` → same
- `unavailableSteps()` → same
- `completedSteps()` → same
- `remainingSteps()` → same
- `firstIncompleteStep()` → use `firstIncompleteStepName()` + `getStep()`
- `lastCompletedStep()` → use `lastCompletedStepName()` + `getStep()`
- `findNextAvailable()` → use `findNextAvailableName()` + `getStep()`
- `findPrevAvailable()` → use `findPrevAvailableName()` + `getStep()`
- `jumpToNextRequired()` → use `jumpToNextRequiredName()` + `getStep()`

This removes 11 methods from helpers and ~50 lines from wizard.ts.

### Task 3.4: Remove Redundant Wizard Accessors
- Remove `wizard.getContext()` — keep `wizard.context` property getter
- Remove `wizard.getCurrent()` — keep `wizard.getCurrentStep()` which returns a richer object
  - Actually keep `getCurrent()` since `getCurrentStep()` creates a wrapper. But document that `wizard.step`, `wizard.context`, `wizard.data` are the preferred access pattern.

### Task 3.5: Remove Niche Helpers (Optional)
Consider removing (or moving to a `diagnostics` sub-export):
- `percentCompletePerStep()` — hardcoded 50% for current step
- `stepDuration()` / `stepAttempts()` — analytics most users implement differently
- `snapshot()` — `wizard.store.state` already exists

---

## Work Stream 4: Examples Fixes
**Agent**: `examples-fixer`
**Files**: All `examples/` directories
**Depends on**: Work Streams 1, 2, 3 (needs fixed APIs)

### Task 4.1: Fix Basic Form Wizard
- Remove `{} as AccountData` pattern — use real defaults: `data: { email: '', password: '', confirmPassword: '' }`
- Remove `as ReturnType<...>` cast on `FormWizard` (should be unnecessary after Task 1.3)
- Verify all types flow correctly after core fixes

### Task 4.2: Fix Advanced Branching
- Remove `as ReturnType<...>` cast on `branchingWizard`
- Remove all `data as typeof initialData.X` casts in validate callbacks (should be unnecessary after Task 1.4)
- Remove the `new` step with `next: "any" as any` — it's test/debug code
- Fix broken `./stepNames` import in `navigation.ts`
- Standardize factory to match basic example pattern

### Task 4.3: Fix Node Saga
- Remove `as ReturnType<...>` cast on `orderWizard`
- Type handler functions properly: `data: InitData` instead of `data: any`
- Use Zod schema types for handler data params

### Task 4.4: Rewrite Persistence Example
- The current example creates `simpleWizard` but never uses it for navigation
- Rewrite `App.tsx` to actually use wizard.next(), wizard.back(), wizard.goTo()
- Remove manual `currentStep` useState — use `useWizard(simpleWizard)` instead
- Show actual persistence adapter pattern (save/load from localStorage using wizard state)

### Task 4.5: Add Minimal Quick-Start Example (NEW)
Create `examples/quick-start/` — under 30 lines of wizard config:
```
examples/quick-start/
  src/
    wizard.ts        # ~20 lines: define 3 steps with data defaults
    App.tsx           # ~30 lines: render steps with useWizard
    main.tsx          # Standard Vite entry
  index.html
  package.json
  vite.config.ts
```
This should be THE first example new users see.

### Task 4.6: Standardize Factory Pattern Across All Examples
All examples should use the same pattern:
```typescript
import { createReactWizardFactory } from '@wizard/react'; // for React examples
// OR
import { createWizardFactory } from '@wizard/core'; // for Node examples

const { step, defineSteps, createWizard } = createReactWizardFactory<MyContext>();
```
No example should use `wizardWithContext` or `reactWizardWithContext` (being removed).

---

## Work Stream 5: Documentation Rewrite
**Agent**: `docs-fixer`
**Files**: `README.md`, `packages/docs/pages/**/*.mdx`
**Depends on**: Work Streams 1-4 (must match final API)

### Task 5.1: Rewrite README.md
- Fix `createWizard` example to use actual API (factory pattern, not 3-generic signature)
- Fix all hook examples to pass wizard as first arg
- Remove 8 fictional hooks (`useWizardState`, `useWizardSharedContext`, `useStepData`, etc.)
- List the actual 8 hooks with correct signatures
- Fix property access: `wizard.step` not `wizard.state.step`
- Fix callback args: `context` not `ctx`
- Remove `load` lifecycle hook references
- Fix `Wizard` instance method list to match actual API
- Add `meta` / `StepMetaCore` to the feature list

### Task 5.2: Fix Getting Started Page
- `pages/getting-started.mdx` — Rewrite code examples to compile against actual API
- Show the factory pattern as the recommended approach
- Use `wizard.step` not `wizard.state.step`

### Task 5.3: Fix React Pages
- `pages/react/quick-start.mdx` — All hooks must show wizard as first arg
- `pages/react/building-ui.mdx` — Fix `useWizard()` destructure, `useWizardProgress()` call
- `pages/react/routing.mdx` — Update to use new consolidated router integration

### Task 5.4: Fix Essentials Pages
- `pages/essentials/defining-flows.mdx` — Show `step()` helper, factory pattern
- `pages/essentials/state-management.mdx` — Fix state access patterns
- `pages/essentials/validation.mdx` — Fix `useStepError` signature, fix Zod import path

### Task 5.5: Fix Advanced Pages
- `pages/advanced/error-handling.mdx` — Fix hook signatures
- `pages/advanced/persistence.mdx` — Fix `WizardPersistence` interface to match actual
- `pages/advanced/complex-flows.mdx` — Verify code examples compile
- `pages/advanced/status-system.mdx` — Verify against actual `StepStatus` type

### Task 5.6: Fix API Reference Pages
- `pages/api-docs/core.mdx` — Must match actual exports from `packages/core/src/index.ts`
- `pages/api-docs/react.mdx` — Must match actual exports from `packages/react/src/index.ts`
- Remove `subscribe()`, `destroy()`, `restore()` from wizard methods list
- Add `store` property documentation
- Document step wrapper / fluent API

### Task 5.7: Add New Documentation Pages
- **"Choosing Your Pattern" guide** — When to use `createWizard` vs `createWizardFactory` vs `createReactWizardFactory`
- **Step Wrapper / Fluent API** page — Document `WizardStep` interface, `getStep()`, chaining
- **Meta System** page — Document `StepMetaCore`, `resolveMetaCore`, `StepMetaUI`
- **`ValOrFn` Pattern** page — Explain the value-or-function pattern used throughout

---

## Execution Order & Dependencies

```
Stream 1 (Core Types)  ──────────────────────────────────┐
                                                          ├─→ Stream 3 (API Cleanup) ─→ Stream 4 (Examples)
Stream 2 (React Adapter) ─── depends on Stream 1 ────────┘                              │
                                                                                         ├─→ Stream 5 (Docs)
                                                                                         │   (must be last)
```

**Parallel execution plan:**
- **Phase 1**: Stream 1 (core types) — can start immediately
- **Phase 2**: Stream 2 (React) + Stream 3 (API cleanup) — start after Stream 1 completes
- **Phase 3**: Stream 4 (examples) — start after Streams 2+3 complete
- **Phase 4**: Stream 5 (docs) — start after Stream 4 completes (must reflect final API)

**Estimated agents needed**: 3-4 running in parallel during Phase 2.

---

## Verification Checklist

After all fixes:
- [ ] `pnpm build` succeeds with zero errors
- [ ] `pnpm test` passes (update tests as needed)
- [ ] Zero `as ReturnType<...>` casts in any example
- [ ] Zero `data as typeof ...` casts in any example
- [ ] `as any` count in core < 12
- [ ] Every code example in docs compiles against actual API
- [ ] Every hook signature in docs matches `packages/react/src/hooks.ts`
- [ ] README hook list matches actual exports
- [ ] Basic form wizard works end-to-end after changes
- [ ] Advanced branching works end-to-end after changes
- [ ] Node saga works end-to-end after changes

# PRP: Fix Wizard Type Inference System — Critical Type Safety Restoration

## Overview

Fix the broken TypeScript type inference system in the wizard library where `getStepData()` returns `unknown` instead of properly inferred types, callback arguments receive `any` types instead of strongly typed arguments, and numerous build errors exist due to missing type exports. This is a critical fix to restore type safety that was lost during the initial refactor.

## Current State Analysis

### Critical Issues Identified

**🚨 Issue 1: getStepData returns `unknown`**
```ts
// CURRENT (broken):
const payment = wizard.getStepData("payment"); // Type: unknown | undefined
const info = wizard.getStepData("info");       // Type: unknown | undefined

// EXPECTED (target):
const payment = wizard.getStepData("payment"); // Type: { method: string; amount: number } | undefined
const info = wizard.getStepData("info");       // Type: { name: string; email: string } | undefined
```

**🚨 Issue 2: Callback args typed as `any`**
```ts
// CURRENT (broken):
beforeExit: ({ data, ctx, updateContext }: { data: any; ctx: any; updateContext: any }) => {

// EXPECTED (target):
beforeExit: ({ data, ctx, updateContext }) => {
  // data: { orderId: string; customerId: string; totalAmount: number }
  // ctx: OrderContext
  // updateContext: (fn: (ctx: OrderContext) => void) => void
```

**🚨 Issue 3: Build system broken**
```bash
src/helpers/createHelpers.ts(3,3): error TS2305: Module '"../types"' has no exported member 'WizardConfig'.
# ... 50+ similar errors across multiple files
```

### Root Cause Analysis

1. **`InferStepData<TDef>` inference engine is broken**
   - `InferFromValidate<TDef>` fails to extract types from validate functions
   - `InferFromBeforeEnter<TDef>` fails to extract return types
   - `InferFromData<TDef>` fails to extract from data initializers
   - `OrNeverToUnknown<T>` helper converts everything to `unknown`

2. **`DataMapFromDefs<TDefs>` mapping fails**
   - Since `InferStepData` returns `unknown`, the entire data map becomes `Record<string, unknown>`
   - Type parameter order is incorrect in factory function

3. **`defineSteps` constraint not enforced**
   - Function signature too permissive with default `any` generics
   - Return type doesn't preserve type constraints
   - Callback arguments lose type information

## Dependencies & Documentation

### TypeScript Advanced Patterns
- **Conditional Types**: https://www.typescriptlang.org/docs/handbook/2/conditional-types.html
- **Type Inference with `infer`**: https://learntypescript.dev/09/l2-conditional-infer/
- **Utility Types**: https://www.typescriptlang.org/docs/handbook/utility-types.html
- **Advanced Types**: https://www.typescriptlang.org/docs/handbook/advanced-types.html

### Key Research Insights
- **Union Type Distribution**: Conditional types distribute over unions automatically with naked type parameters
- **`never` Type Handling**: `never` types disappear in union types, enabling sophisticated filtering
- **Recursive Type Limitations**: TypeScript has limits on recursive conditional types to prevent infinite instantiation
- **Inference Failures**: Complex conditional types often fail to `unknown` when type constraints are too complex

### Build System
- **tsup**: Already configured for ESM/CJS/types output
- **TypeScript**: Strict mode enabled, requires proper type inference
- **Monorepo**: Package boundaries must maintain type safety

## Implementation Blueprint

### Phase 1: Fix Type Inference Engine

**1.1 Redesign `InferStepData<TDef>` conditional types**
```ts
// CURRENT (broken):
type InferFromValidate<TDef> =
  TDef extends { validate: (a: infer A) => any }
    ? A extends { data: infer D } ? D : never : never;

// TARGET (fixed):
type InferFromValidate<TDef> =
  TDef extends { validate: (args: { data: infer Data }) => any }
    ? Data
    : never;

type InferFromBeforeEnter<TDef> =
  TDef extends { beforeEnter: (...args: any[]) => infer R | Promise<infer R> }
    ? R extends void
      ? never
      : R extends Partial<infer D>
        ? D
        : R
    : never;

type InferFromData<TDef> =
  TDef extends { data: infer D }
    ? D extends ValOrFn<infer X, any>
      ? X
      : D
    : never;

// IMPROVED: Better union handling with priority
export type InferStepData<TDef> =
  InferFromValidate<TDef> extends never
    ? InferFromBeforeEnter<TDef> extends never
      ? InferFromData<TDef> extends never
        ? unknown  // Fallback to unknown if no inference possible
        : InferFromData<TDef>
      : InferFromBeforeEnter<TDef>
    : InferFromValidate<TDef>;
```

**1.2 Fix `DataMapFromDefs<TDefs>` mapping**
```ts
// Ensure proper type parameter order and constraint preservation
export type DataMapFromDefs<TDefs> = {
  [K in keyof TDefs & string]: InferStepData<TDefs[K]>
};
```

**1.3 Fix wizard factory type signature**
```ts
// CURRENT (incorrect parameter order):
export declare function createWizard<C, E, TDefs extends Record<string, any>>(
  opts: CreateWizardOptions<C, E, TDefs>
): Wizard<StepIds<TDefs>, StepIds<TDefs>, DataMapFromDefs<TDefs>, E>;

// FIXED (correct parameter order):
export declare function createWizard<C, E, TDefs extends Record<string, any>>(
  opts: CreateWizardOptions<C, E, TDefs>
): Wizard<C, StepIds<TDefs>, DataMapFromDefs<TDefs>, E>;
```

### Phase 2: Fix Callback Argument Typing

**2.1 Redesign `defineSteps` function with proper constraints**
```ts
// CURRENT (too permissive):
export function defineSteps<_C, _E, T extends Record<string, any>>(defs: T) {
  return defs as T;
}

// TARGET (properly constrained):
export function defineSteps<
  C = unknown,
  E = never,
  T extends Record<string, StepDefinitionInput<C, keyof T & string, E>> = never
>(
  defs: T
): { [K in keyof T]: StepDefinitionNormalized<C, keyof T & string, E, T[K]> } {
  return defs as any; // Runtime normalization happens in factory
}

// New helper types:
type StepDefinitionInput<C, S extends string, E> = {
  data?: unknown;
  validate?: (args: { data: unknown }) => void;
  beforeEnter?: (...args: any[]) => any;
  next: readonly S[] | ((args: any) => S | readonly S[]);
  // ... other properties
};

type StepDefinitionNormalized<C, S extends string, E, TDef> =
  PartialStepDefinition<C, S, E, TDef>;
```

**2.2 Ensure callback arguments are properly typed**
```ts
// The key is that PartialStepDefinition already has the right structure,
// but defineSteps needs to enforce it and preserve the constraint
```

### Phase 3: Clean Up Build Errors

**3.1 Export missing types or create compatibility layer**
```ts
// packages/core/src/types.ts - Add missing exports:
export type WizardConfig<C, E, TDefs> = CreateWizardOptions<C, E, TDefs>;
export type WizardTransitionEvent = {
  step: string;
  prev?: StepStatus;
  next: StepStatus
};
export type InferContext<T> = T extends { context: infer C } ? C : unknown;
export type InferSteps<T> = T extends { steps: infer S } ? keyof S & string : string;
export type InferDataMap<T> = T extends { steps: infer S } ? DataMapFromDefs<S> : Record<string, unknown>;
export type StepRuntime = {
  status?: StepStatus;
  attempts?: number;
  startedAt?: number;
  finishedAt?: number;
};
```

**3.2 Fix specific file errors**
- Update imports in all helper files to use new type names
- Fix string array to generic step array assignments with proper type assertions
- Add explicit type annotations where inference fails

**3.3 Remove old wizard directory**
```bash
# Remove these obsolete files:
src/wizard/stateManager.ts
src/wizard/contextManager.ts
src/wizard/history.ts
src/wizard/runtimeMarkers.ts
src/wizard/stepLifecycle.ts
src/wizard/transitionController.ts
```

### Phase 4: Comprehensive Testing

**4.1 Create type inference test suite**
```ts
// packages/core/src/tests/fix-type-inference.type-test.ts
import { defineSteps, createWizard } from '../index';

// Test 1: Basic data inference
const basicSteps = defineSteps({
  step1: {
    data: { name: 'test', count: 42 },
    next: ['step2'],
  },
  step2: {
    data: { email: 'test@test.com' },
    next: [],
  },
});

const basicWizard = createWizard({ context: {}, steps: basicSteps });

// These should be properly typed:
const step1Data = basicWizard.getStepData('step1'); // { name: string; count: number } | undefined
const step2Data = basicWizard.getStepData('step2'); // { email: string } | undefined

// Test 2: Validate function inference
const validateSteps = defineSteps({
  validated: {
    validate: ({ data }: { data: { email: string; password: string } }) => {
      // Validation logic
    },
    next: [],
  }
});

const validateWizard = createWizard({ context: {}, steps: validateSteps });
const validatedData = validateWizard.getStepData('validated'); // { email: string; password: string } | undefined

// Test 3: Callback argument typing
const callbackSteps = defineSteps({
  withCallbacks: {
    data: { value: 123 },
    beforeExit: ({ data, ctx, updateContext }) => {
      // data should be: { value: number }
      // ctx should be: {}
      // updateContext should be: (fn: (ctx: {}) => void) => void
    },
    next: [],
  }
});
```

**4.2 Update example files**
- Remove explicit `any` type annotations from node-saga-wizard
- Verify all examples compile with proper type inference
- Add type assertions to demonstrate working inference

## Validation Gates

### Syntax & Type Checking
```bash
# Core package must compile without errors
cd packages/core && npx tsc --noEmit

# React package must compile without errors
cd packages/react && npx tsc --noEmit

# All examples must compile without errors
cd examples/basic-form-wizard && npx tsc --noEmit
cd examples/node-saga-wizard && npx tsc --noEmit
cd examples/react-router-wizard && npx tsc --noEmit
```

### Type Inference Verification
```bash
# Type-only tests must pass compilation
cd packages/core && npx tsc --noEmit src/tests/fix-type-inference.type-test.ts

# getStepData should return proper types (manual verification)
```

### Build System
```bash
# All packages must build successfully
pnpm build

# No TypeScript errors in any package
pnpm -r exec "npx tsc --noEmit"
```

### Runtime Validation
```bash
# Examples should run without runtime errors
cd examples/node-saga-wizard && npm run build && node dist/index.js auto

# React examples should build for production
cd examples/basic-form-wizard && npm run build
cd examples/react-router-wizard && npm run build
```

## Error Handling & Gotchas

### TypeScript Inference Challenges
- **Complex conditional types**: May hit TypeScript's inference limits - break into simpler intermediate types
- **Union type distribution**: Use `[T] extends [never]` pattern to prevent unwanted distribution
- **Circular type references**: Ensure step definitions don't create recursive type dependencies
- **`never` type handling**: Use proper fallbacks when inference fails completely

### Build System Issues
- **Import/export order**: Ensure all type dependencies are exported before being imported
- **Type-only imports**: Use `import type` for type-only dependencies to avoid circular imports
- **Generic constraints**: Too restrictive constraints can break inference, too loose allows `any`

### Common Type Failures
- **Validate function extraction**: Ensure parameter destructuring patterns match exactly
- **beforeEnter return type**: Handle both sync and async return types properly
- **Data initializer values**: Function vs value detection needs proper guards

### Migration Compatibility
- **Existing examples**: May need type annotations during transition period
- **API surface**: Ensure existing wizard creation patterns still work
- **Error messages**: Provide helpful error messages when type inference fails

## Success Criteria

### Functional Requirements ✅
- [ ] `wizard.getStepData("payment")` returns `{ method: string; amount: number } | undefined`
- [ ] `wizard.getStepData("info")` returns `{ name: string; email: string } | undefined`
- [ ] Callback args `({ data, ctx, updateContext })` are strongly typed (no `any`)
- [ ] `defineSteps()` enforces proper step definition constraints
- [ ] All examples demonstrate working type inference without explicit annotations

### Technical Requirements ✅
- [ ] All packages build successfully with no TypeScript errors
- [ ] Type inference works with validate functions, data initializers, and beforeEnter
- [ ] Callback argument types are automatically inferred from step definitions
- [ ] Legacy type exports maintained for compatibility
- [ ] Type-only tests pass compilation verification

### Quality Requirements ✅
- [ ] Zero `any` types in core type system (except where explicitly needed)
- [ ] Type inference chain documented with examples
- [ ] Build time impact minimal (under 2 seconds additional)
- [ ] Error messages guide developers to correct patterns
- [ ] Examples showcase all inference patterns working

## Task Execution Order

1. **🔥 CRITICAL**: Fix `InferStepData<TDef>` conditional type engine
2. **🔥 CRITICAL**: Fix `DataMapFromDefs<TDefs>` mapping and wizard type signature
3. **🔥 CRITICAL**: Verify `getStepData()` returns proper types with test suite
4. **⚠️ HIGH**: Fix `defineSteps` function signature with proper constraints
5. **⚠️ HIGH**: Remove old type references and export compatibility layer
6. **📝 MEDIUM**: Update all example files to remove explicit `any` annotations
7. **🧪 MEDIUM**: Create comprehensive type inference test suite
8. **✅ LOW**: Verify all validation gates pass

## Confidence Score: 8/10

**Rationale**: This PRP provides comprehensive context including:
- ✅ Complete current state analysis with specific broken code examples
- ✅ Detailed root cause analysis of TypeScript inference failures
- ✅ External TypeScript documentation and patterns research
- ✅ Step-by-step implementation blueprint with code examples
- ✅ Executable validation commands for verification
- ✅ Common gotchas and error handling strategies
- ✅ Clear success criteria with measurable outcomes

**Risk Mitigation**:
- TypeScript conditional type complexity addressed with incremental approach
- Build system errors catalogued with specific file-by-file fixes
- Testing strategy includes both type-only and runtime validation
- Migration path preserves compatibility through type exports

**Uncertainty (20% risk)**:
- TypeScript inference engine may require multiple iterations to get conditional types exactly right
- Some edge cases in complex step definitions may need manual type annotations as fallback
- Build system cleanup may uncover additional dependencies that need type compatibility

The comprehensive research and specific code examples should enable successful one-pass implementation, with the main risk being the inherent complexity of TypeScript's conditional type system.
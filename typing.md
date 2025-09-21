here's a detailed breakdown of everything that needs to be fixed:

  🔧 1. Fix Type Inference System - getStepData returns unknown

  Root Cause Analysis:

  - InferStepData<TDef> is not properly extracting types from step definitions
  - DataMapFromDefs<TDefs> mapping is broken
  - Type inference priority (validate → beforeEnter → data) is not working

  Specific Fixes Needed:

  A. Fix InferStepData<TDef> inference engine:

  // CURRENT (broken):
  type InferFromValidate<TDef> =
    TDef extends { validate: (a: infer A) => any }
      ? A extends { data: infer D } ? D : never : never;

  // NEEDS TO BE FIXED to properly extract from:
  // 1. validate function parameter types
  // 2. beforeEnter return types  
  // 3. data initializer types

  B. Fix DataMapFromDefs<TDefs> mapping:

  // CURRENT:
  export type DataMapFromDefs<TDefs> = { [K in keyof TDefs & string]: InferStepData<TDefs[K]> };

  // Issue: InferStepData returns `unknown`, so entire map becomes `Record<string, unknown>`

  C. Fix wizard type parameter order:

  // CURRENT (incorrect):
  ): Wizard<C, StepIds<TDefs>, DataMapFromDefs<TDefs>, E>

  // The Wizard<C,S,D,E> signature expects context first, but we had steps first

  D. Test the inference chain:

  - Create test cases that verify each inference step works
  - Validate that wizard.getStepData("stepName") returns proper type
  - Ensure type inference works with validate functions, data initializers, and beforeEnter

  ---
  🔧 2. Fix Callback Argument Typing - still showing as any

  Root Cause Analysis:

  - defineSteps constraint is not properly applied
  - Callback functions receive any instead of properly typed arguments
  - PartialStepDefinition mapping is not enforced at runtime

  Specific Fixes Needed:

  A. Fix defineSteps function signature:

  // CURRENT (too permissive):
  export function defineSteps<C = any, E = never, T extends Record<string, any> = any>(
    defs: { [K in keyof T]: PartialStepDefinition<C, keyof T & string, E, T[K]> }
  ): T

  // ISSUES:
  // 1. Generic defaults to `any` 
  // 2. Return type `T` doesn't preserve constraints
  // 3. No enforcement of proper callback typing

  B. Fix callback argument inference:

  // These should be strongly typed based on step definition:
  beforeExit: ({ data, ctx, updateContext }) => {
  //            ^^^^  ^^^  ^^^^^^^^^^^^^
  //            Should be: StepData, Context, (ctx: Context) => void

  C. Create proper constraint mapping:

  // Need to ensure callbacks receive proper types:
  type StepArgs<C, S, Data, E> = {
    step: S;
    ctx: Readonly<C>;
    data: Readonly<Data> | undefined;  // Should be actual inferred Data, not any
    updateContext: (fn: (ctx: C) => void) => void;
    // ...
  };

  D. Fix example callback typing:

  // IN node-saga-wizard/src/index.ts:
  // CURRENT (broken):
  beforeExit: ({ data, updateContext }: { data: any; updateContext: any }) => {

  // SHOULD BE (properly inferred):
  beforeExit: ({ data, updateContext }) => {
  // data should be: { orderId: string; customerId: string; totalAmount: number }
  // updateContext should be: (fn: (ctx: OrderContext) => void) => void

  ---
  🔧 3. Clean up Old Type References Causing Build Errors

  Root Cause Analysis:

  - Old type system remnants still referenced throughout codebase
  - Missing type exports that other files depend on
  - Inconsistent type naming and structure

  Specific Fixes Needed:

  A. Remove/replace missing type exports:

  // FILES WITH ERRORS:
  src/helpers/availability.ts(1,15): error TS2305: Module '"../types"' has no exported member 'WizardConfig'.
  src/helpers/createHelpers.ts(3,3): error TS2305: Module '"../types"' has no exported member 'WizardConfig'.
  // ... and 50+ more similar errors

  // NEED TO:
  // 1. Either export these types again or
  // 2. Update all files to use new type names

  B. Fix specific missing types:

  - WizardConfig → Replace with CreateWizardOptions<C, E, TDefs>
  - WizardTransitionEvent → Replace with new event type
  - InferContext, InferSteps, InferDataMap → Update to use new inference types
  - StepRuntime → Replace with runtime state type
  - WizardPersistence → Replace with new persistence type

  C. Fix files with specific errors:

  src/helpers/createHelpers.ts:
  // ERRORS:
  src/helpers/createHelpers.ts(66,46): error TS2345: Argument of type 'readonly string[]' is not assignable to parameter of type 'readonly S[]'.

  // FIX: Proper generic constraints and type assertions

  src/selectors.ts:
  // ERRORS: 
  src/selectors.ts(159,40): error TS7006: Parameter 'p' implicitly has an 'any' type.

  // FIX: Add proper type annotations

  src/tests/type-inference.type-test.ts:
  // ERRORS:
  src/tests/type-inference.type-test.ts(111,7): error TS2322: Type 'unknown' is not assignable to type '{ aField: string; } | undefined'.

  // FIX: Update tests to use new API and verify proper inference

  D. Clean up old wizard directory:

  # REMOVE these old files that are no longer needed:
  src/wizard/createWizard.ts  # ✅ Already removed
  src/wizard/stateManager.ts
  src/wizard/contextManager.ts
  src/wizard/history.ts
  src/wizard/runtimeMarkers.ts
  src/wizard/stepLifecycle.ts
  src/wizard/transitionController.ts

  # Or update them to work with new type system

  E. Update package exports:

  // packages/core/src/index.ts needs to export correct types
  export type {
    Wizard,
    WizardState,
    WizardHelpers,
    StepArgs,
    StepDefinition,
    // ... but NOT the old ones causing errors
  } from './types';

  ---
  📋 Priority Order for Fixes:

  1. 🔥 CRITICAL: Fix InferStepData<TDef> type inference engine
  2. 🔥 CRITICAL: Fix DataMapFromDefs<TDefs> mapping
  3. 🔥 CRITICAL: Verify getStepData() returns proper types
  4. ⚠️ HIGH: Fix defineSteps callback argument typing
  5. ⚠️ HIGH: Remove old type references causing build errors
  6. 📝 MEDIUM: Update all example files to use proper typing
  7. 🧪 LOW:  Create comprehensive type inference tests

  🎯 Success Criteria:

  - wizard.getStepData("payment") returns { method: string; amount: number } | undefined
  - Callback args ({ data, ctx, updateContext }) are strongly typed (no any)
  - All packages build without TypeScript errors
  - Examples demonstrate proper type inference working

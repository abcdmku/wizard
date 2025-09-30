# PRP: TypeScript Type Safety and Naming Consistency Fixes

## 🎯 Objective

Fix all TypeScript type errors in the wizard core package and ensure consistent naming conventions across all files. This will improve type safety, reduce runtime errors, and maintain code quality standards.

## 📋 Current State Analysis

### Problems Identified

#### 1. **Naming Inconsistency: `ctx` vs `context`**

**Files Affected:**
- `src/helpers/availability.ts` (lines 73, 97)
- `src/helpers/createHelpers.ts` (line 81)
- `src/helpers/requirements.ts` (lines 62, 74)
- `src/selectors.ts` (lines 54, 66)

**Issue:**
```typescript
// INCORRECT: Using 'ctx' property
const result = stepDef.canEnter({ ctx: snapshot.context });

// CORRECT: Should use 'context' property
const result = stepDef.canEnter({ context: snapshot.context, ... });
```

**Root Cause:**
The `StepArgs` type (types.ts:22-29) defines the property as `context`, not `ctx`. This creates type errors because TypeScript expects `context: Readonly<C>` but finds `ctx`.

---

#### 2. **Type Mismatches in Function Calls**

**Files Affected:**
- `src/helpers/progress.ts` (line 87)
- `src/helpers/requirements.ts` (lines 25, 62)
- `src/selectors.ts` (lines 54, 105, 241)

**Issue:**
```typescript
// INCORRECT: Passing incomplete arguments
stepDef.complete(stepData, state.context);  // Expected 1 arg, got 2
// OR
stepDef.required(context);  // Expected StepArgs object, got just context

// CORRECT: Should pass complete StepArgs
const args: StepArgs<C, S, D[S], E> = {
  step,
  context: state.context,
  data: state.data[step],
  updateContext,
  setStepData,
  emit
};
stepDef.complete(args);
```

**Root Cause:**
Functions expecting `StepArgs<C, S, Data, E>` are being called with individual properties or wrong number of arguments.

---

#### 3. **Resolve Function with Boolean Literals**

**Files Affected:**
- `src/helpers/availability.ts` (lines 73, 97)

**Issue:**
```typescript
// ValOrFn<boolean, ...> expands to: true | false | ((args: StepArgs) => boolean)
const result = stepDef.canEnter(...);  // Type error: 'true' is not callable
```

**Root Cause:**
When `ValOrFn<boolean, A>` is used, TypeScript expands it to `true | false | ((args: A) => boolean)`. The `resolve()` function tries to call this value, but `true` and `false` literals are not callable.

**Reference:** [TypeScript narrowing documentation](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)

---

#### 4. **Missing Prerequisites Property**

**Files Affected:**
- `src/helpers/createHelpers.ts` (lines 125-126)
- `src/helpers/requirements.ts` (lines 90-91)
- `src/selectors.ts` (lines 158-159)

**Issue:**
```typescript
// Accessing non-existent property
if (stepDef?.prerequisites) {  // Property 'prerequisites' does not exist
  return stepDef.prerequisites;
}
```

**Root Cause:**
The `StepDefinition` type (types.ts:96-118) doesn't include a `prerequisites` property, but the code is trying to access it. This suggests either:
- The property needs to be added to the type
- The code needs to be removed/updated

---

#### 5. **Return Type Mismatches**

**Files Affected:**
- `src/helpers/createHelpers.ts` (lines 92, 93, 102, 103, 106-109, 117-119)

**Issue:**
```typescript
// INCORRECT: Returning step names instead of step objects
availableSteps: () => availability.availableSteps(),  // Returns readonly S[]
// Type error: Type 'readonly S[]' is not assignable to 'readonly WizardStep[]'

// CORRECT: Should map names to step objects
availableSteps: () => availability.availableSteps().map(name => wizard.getStep(name))
```

**Root Cause:**
The helper methods are defined to return `WizardStep` objects, but they're returning step names (strings) instead.

---

#### 6. **Implicit Any Types in Test Files**

**Files Affected:** 40+ test files in `src/tests/`

**Note:** These files are excluded from the build by `tsconfig.json` (line 9: `"exclude": ["**/*.test.ts"]`), so they don't affect production code. However, fixing them improves code quality and type safety in tests.

---

## 🚀 Solution Architecture

### Design Principles

1. **Type Safety First**: Follow TypeScript strict mode best practices (2025 standards)
   - Use `unknown` instead of `any`
   - Enable all strict type checking options
   - Eliminate implicit any types

2. **Consistent Naming**: Use the canonical property names defined in type definitions
   - `context` (not `ctx`)
   - Follow established conventions in types.ts

3. **Proper Type Flow**: Ensure correct argument shapes match type definitions
   - Pass complete `StepArgs` objects
   - Use proper type narrowing for `ValOrFn` types

**References:**
- [TypeScript Best Practices 2025](https://dev.to/mitu_mariam/typescript-best-practices-in-2025-57hb)
- [TypeScript Strict Mode](https://www.typescriptlang.org/tsconfig/strict.html)

---

## 🔧 Implementation Blueprint

### Phase 1: Fix Naming Inconsistencies

#### Task 1.1: Replace `ctx` with `context` in helper files

**Files to Modify:**
1. `src/helpers/availability.ts`
2. `src/helpers/createHelpers.ts`
3. `src/helpers/requirements.ts`
4. `src/selectors.ts`

**Pattern:**
```typescript
// BEFORE
const result = stepDef.canEnter({ ctx: snapshot.context });

// AFTER
const result = stepDef.canEnter({
  step,
  context: snapshot.context,
  data: snapshot.data[step],
  updateContext: () => {},  // Provide stub if not needed
  setStepData: () => {},
  emit: () => {}
});
```

**Implementation Steps:**
1. Search for all occurrences of `{ ctx:` in core files (excluding tests)
2. Replace with proper `StepArgs` object construction
3. Ensure all required properties are included

---

### Phase 2: Fix Type Mismatches

#### Task 2.1: Fix `resolve()` calls with boolean types

**File:** `src/helpers/availability.ts`

**Pattern:**
```typescript
// BEFORE
const result = stepDef.canEnter({ ctx: snapshot.context });
// Error: This expression is not callable. Type 'true' has no call signatures.

// AFTER
const canEnterValue = stepDef.canEnter;
if (typeof canEnterValue === 'function') {
  const args: StepEnterArgs<C, S, D[S], E> = {
    step,
    context: snapshot.context,
    data: snapshot.data[step],
    updateContext: () => {},
    setStepData: () => {},
    emit: () => {},
    from: snapshot.step
  };
  const result = canEnterValue(args);
} else {
  const result = canEnterValue;  // It's a boolean literal
}
```

**Implementation Steps:**
1. Identify all `resolve()` calls that work with `ValOrFn<boolean, ...>`
2. Add type narrowing before calling
3. Handle both function and boolean literal cases explicitly

---

#### Task 2.2: Fix function call argument shapes

**Files:**
- `src/helpers/progress.ts`
- `src/helpers/requirements.ts`
- `src/selectors.ts`

**Pattern:**
```typescript
// BEFORE
stepDef.complete(stepData, state.context);  // Wrong argument count

// AFTER
const args: StepArgs<C, S, D[S], E> = {
  step,
  context: state.context,
  data: stepData,
  updateContext: (fn) => { /* implementation */ },
  setStepData: (data) => { /* implementation */ },
  emit: (event) => { /* implementation */ }
};
const result = resolve(stepDef.complete, args);
```

**Implementation Steps:**
1. For each function call error, construct proper `StepArgs` object
2. Use the `resolve()` utility to handle `ValOrFn` types correctly
3. Ensure all required properties are present

---

### Phase 3: Handle Prerequisites Property

#### Task 3.1: Add prerequisites to StepDefinition type OR remove usage

**Option A: Add to Type** (if feature is needed)
```typescript
// File: src/types.ts
export type StepDefinition<C,S extends string,Data,E = never> = {
  // ... existing properties
  prerequisites?: readonly S[];  // Add this
};
```

**Option B: Remove Usage** (if feature is deprecated)
```typescript
// Remove these blocks from:
// - src/helpers/createHelpers.ts
// - src/helpers/requirements.ts
// - src/selectors.ts

// REMOVE:
if (stepDef?.prerequisites) {
  return stepDef.prerequisites;
}
```

**Decision Point:** Check with codebase documentation or commit history to determine if prerequisites is a planned feature or deprecated code.

**Implementation Steps:**
1. Grep for all `prerequisites` usage
2. Check if it's used in any actual wizard definitions
3. Either add to type or remove usage based on findings

---

### Phase 4: Fix Helper Return Types

#### Task 4.1: Map step names to step objects in createHelpers.ts

**File:** `src/helpers/createHelpers.ts`

**Pattern:**
```typescript
// BEFORE
availableSteps: () => availability.availableSteps(),  // Returns S[]

// AFTER
availableSteps: () => {
  const stepNames = availability.availableSteps();
  return stepNames.map(name => wizard.getStep(name));
}
```

**Issue:** This requires access to the `wizard` object, which may not be available in the helper creation context.

**Solution Approaches:**

**Approach A: Add wizard parameter**
```typescript
export function createHelpers<C, S extends string, D extends Record<S, unknown>, E>(
  config: ...,
  state: ...,
  wizard: Wizard<C, S, D, E>  // Add wizard parameter
): WizardHelpers<C, S, D> {
  // Now can map to step objects
}
```

**Approach B: Change return type to names**
Update `WizardHelpers` type to return step names instead of objects for these methods:
```typescript
// File: src/types.ts
export type WizardHelpers<C,S extends string,D extends Record<S,unknown>> = {
  availableSteps(): readonly S[];  // Changed from WizardStep[]
  // ... etc
};
```

**Recommendation:** Check how these methods are used in wizard.ts to determine the best approach.

**Implementation Steps:**
1. Analyze usage of helper methods in wizard.ts
2. Choose appropriate solution (pass wizard or change types)
3. Update all affected helper methods consistently

---

### Phase 5: Clean Up Test Files (Optional)

**Priority:** Low (tests are excluded from build)

**Benefits:**
- Better test maintainability
- Catch test logic errors at compile time
- Demonstrate type safety throughout codebase

**Pattern:**
```typescript
// BEFORE
const result = beforeEnter({ data });  // Implicit any on 'data'

// AFTER
const result = beforeEnter({ data }: { data: AccountData });
```

**Implementation Steps:**
1. Add explicit type annotations to callback parameters
2. Remove unused variables (fix TS6133 errors)
3. Add `@ts-expect-error` comments for intentional type violations in tests

---

## ✅ Validation Gates

### Gate 1: Type Check
```bash
cd packages/core
npx tsc --noEmit
# Expected: 0 errors in src/ files (excluding tests)
```

### Gate 2: Build
```bash
cd packages/core
npm run build
# Expected: Success with no errors
```

### Gate 3: Verify Examples Still Build
```bash
cd examples/basic-form-wizard
npm run build
# Expected: Success
```

### Gate 4: Run Tests
```bash
cd packages/core
npm test
# Expected: All tests pass
```

---

## 📝 Implementation Checklist

### Phase 1: Naming Fixes
- [ ] Fix `ctx` → `context` in src/helpers/availability.ts
- [ ] Fix `ctx` → `context` in src/helpers/createHelpers.ts
- [ ] Fix `ctx` → `context` in src/helpers/requirements.ts
- [ ] Fix `ctx` → `context` in src/selectors.ts
- [ ] Verify no more `ctx:` usage in core files

### Phase 2: Type Mismatches
- [ ] Fix `resolve()` calls with boolean types in availability.ts
- [ ] Fix function call arguments in progress.ts
- [ ] Fix function call arguments in requirements.ts
- [ ] Fix function call arguments in selectors.ts
- [ ] Test type narrowing works correctly

### Phase 3: Prerequisites
- [ ] Determine if prerequisites is needed feature
- [ ] Either add to StepDefinition type OR remove usage
- [ ] Update all affected files consistently

### Phase 4: Helper Return Types
- [ ] Analyze helper method usage in wizard.ts
- [ ] Choose solution (pass wizard or change types)
- [ ] Update createHelpers.ts return values
- [ ] Update WizardHelpers type if needed
- [ ] Verify all helper methods are consistent

### Phase 5: Test Fixes (Optional)
- [ ] Fix implicit any types in test files
- [ ] Remove unused variables
- [ ] Add proper type annotations

### Final Validation
- [ ] Run `npx tsc --noEmit` - passes
- [ ] Run `npm run build` - passes
- [ ] Run `npm test` - passes
- [ ] Build example apps - pass
- [ ] Verify no new type errors introduced

---

## 🎓 Learning Resources

### TypeScript Best Practices
- [TypeScript Handbook: Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
- [TypeScript Best Practices 2025](https://dev.to/mitu_mariam/typescript-best-practices-in-2025-57hb)
- [TypeScript Strict Mode](https://www.typescriptlang.org/tsconfig/strict.html)

### Type Guards and Narrowing
- [Type Guards](https://2ality.com/2020/06/type-guards-assertion-functions-typescript.html)
- [Safe Type Narrowing Guide](https://thoughtspile.github.io/2023/01/31/typescript-safe-narrow/)

### Pattern References
- Existing PRP: `PRPs/enhanced-typing-fluent-api.md` - Similar type safety improvements
- Existing PRP: `PRPs/fix-type-inference-system.md` - Type inference fixes

---

## 📊 Risk Assessment

### Low Risk
- Naming fixes (`ctx` → `context`) - Mechanical changes with clear patterns
- Test file fixes - Don't affect production build

### Medium Risk
- Prerequisites property - Needs investigation to determine if feature or tech debt
- Helper return type fixes - Requires understanding of usage patterns

### High Risk
- None identified - All fixes are type-level changes that TypeScript will validate

---

## 🎯 Success Metrics

1. **Zero Type Errors**: `npx tsc --noEmit` reports 0 errors in src/ files
2. **Build Success**: `npm run build` completes without errors
3. **Test Pass Rate**: All existing tests continue to pass
4. **Example Apps**: All example apps build and run correctly
5. **Code Quality**: No new `@ts-ignore` or `as any` introduced

---

## 📈 Confidence Score: **8/10**

### Reasoning:

**Strengths (+):**
- Clear error messages from TypeScript compiler
- Well-defined types already exist
- Mechanical fixes with predictable patterns
- Validation gates are executable and comprehensive

**Risks (-):**
- Prerequisites property needs investigation (may require business logic decision)
- Helper return type fixes may require understanding usage context
- Large number of test files to fix (optional but time-consuming)

**Mitigation:**
- Start with mechanical fixes (naming)
- Use TypeScript compiler as guide for each fix
- Test incrementally after each phase
- Leave test fixes for last (optional, doesn't block build)

---

## 🔄 Iterative Implementation Strategy

1. **Phase 1 First**: Fix all naming issues - these are mechanical and safe
2. **Validate**: Run type check after Phase 1
3. **Phase 2**: Fix type mismatches one file at a time, validating after each
4. **Validate**: Run type check and build after Phase 2
5. **Phase 3**: Investigate prerequisites, make decision, implement
6. **Validate**: Full validation gates
7. **Phase 4**: Fix helper return types based on usage analysis
8. **Final Validation**: All gates pass
9. **Phase 5** (Optional): Clean up test files if time permits

This approach ensures early validation and reduces risk of introducing cascading errors.
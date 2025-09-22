# PRP: Enhanced Typing and Fluent API for Wizard Steps

## 🎯 Objective

Enhance the wizard library with proper return type inference and implement a fluent API pattern that allows method chaining on step objects. Fix type inference issues where `wizard.getCurrent().data` and `wizard.getStepData()` return `unknown` instead of properly typed data.

## 📋 Current State Analysis

### Problems Identified

1. **Type Inference Issues**:
   ```typescript
   wizard.getCurrent();
   // Returns: { step: "step1"; data: Readonly<unknown> | undefined; context: AppContext }
   // Expected: { step: "step1"; data: Readonly<StepDataType> | undefined; context: AppContext }

   wizard.getStepData('step1');
   // Returns: unknown
   // Expected: StepDataType | undefined
   ```

2. **Missing Fluent API**:
   ```typescript
   // Current: void methods, no chaining
   wizard.markIdle('step1'); // returns void
   wizard.next(); // returns Promise<void>

   // Desired: Fluent chaining
   const step = wizard.getStep('step1').markIdle().markLoading();
   const nextStep = wizard.next(); // returns new step object
   ```

3. **API Organization Issues**:
   - Too many methods on the main wizard object
   - Step-specific operations should be on step objects
   - Navigation methods should return step objects for chaining

### Current Implementation Analysis

**Key Files Analyzed**:
- `/packages/core/src/types.ts` (lines 285-305): Current Wizard type definition
- `/packages/core/src/wizard.ts` (lines 312-459): Current wizard implementation
- `/packages/core/src/wizard-factory.ts`: Context-aware factory pattern
- `/packages/core/src/tests/factory-step-test.ts`: Current usage patterns

**Current Type Definitions**:
```typescript
export type Wizard<C,S extends string,D extends Record<S, unknown>,_E> = {
  // Navigation methods return void/Promise<void>
  next(args?: { data?: D[S] }): Promise<void>;
  goTo(step: S, args?: { data?: D[S] }): Promise<void>;

  // Data access returns unknown types
  getStepData<K extends S>(step: K): D[K] | undefined;
  getCurrent(): { step: S; data: Readonly<D[S]> | undefined; context: Readonly<C> };

  // Step operations return void
  markError(step: S, err: unknown): void;
  markLoading(step: S): void;
  // ... more void methods
};
```

## 🚀 Solution Architecture

### 1. Fluent API Design Pattern

Based on research from TypeScript fluent interface patterns (https://shaky.sh/fluent-interfaces-in-typescript/), implement:

- **Polymorphic `this` return types** for method chaining
- **Type-safe step wrapper objects** with proper generic constraints
- **Immutable DSL approach** where each method returns a new object/state

### 2. Enhanced Type Flow

Leverage the existing wizard factory pattern to ensure proper type inference:

```typescript
// Type flow: Factory → Steps → Step Operations
const factory = createWizardFactory<AppContext>();
const wizard = factory.createWizard(context, steps);
const step = wizard.getStep('step1'); // Properly typed step object
```

### 3. Step Wrapper Implementation

Create `WizardStep<StepName, Data, Context>` objects that:
- Expose step-specific operations
- Maintain proper type information
- Enable method chaining
- Provide access to step data with correct types

## 🔧 Implementation Blueprint

### Phase 1: Core Type Infrastructure

**File**: `src/step-wrapper.ts` (NEW)
```typescript
export interface WizardStep<
  StepName extends string,
  Data,
  Context,
  AllSteps extends string = string
> {
  readonly name: StepName;
  readonly data: Readonly<Data> | undefined;
  readonly context: Readonly<Context>;

  // Fluent step operations
  markIdle(): WizardStep<StepName, Data, Context, AllSteps>;
  markLoading(): WizardStep<StepName, Data, Context, AllSteps>;
  markSkipped(): WizardStep<StepName, Data, Context, AllSteps>;
  markError(error: unknown): WizardStep<StepName, Data, Context, AllSteps>;
  markTerminated(error?: unknown): WizardStep<StepName, Data, Context, AllSteps>;

  // Data operations
  setData(data: Data): WizardStep<StepName, Data, Context, AllSteps>;
  updateData(updater: (data: Data) => Partial<Data>): WizardStep<StepName, Data, Context, AllSteps>;

  // Navigation that returns step objects
  next(): Promise<WizardStep<AllSteps, unknown, Context, AllSteps>>;
  goTo<Target extends AllSteps>(step: Target): Promise<WizardStep<Target, unknown, Context, AllSteps>>;
  back(): Promise<WizardStep<AllSteps, unknown, Context, AllSteps>>;
}
```

### Phase 2: Enhanced Wizard Interface

**File**: `src/types.ts` (MODIFY)
```typescript
export type EnhancedWizard<C, S extends string, D extends Record<S, unknown>, E> =
  Wizard<C, S, D, E> & {
  // Enhanced methods with proper return types
  getStep<K extends S>(step: K): WizardStep<K, D[K], C, S>;
  getCurrentStep(): WizardStep<S, D[S], C, S>;

  // Navigation methods that return step objects
  next(args?: { data?: D[S] }): Promise<WizardStep<S, unknown, C, S>>;
  goTo<K extends S>(step: K, args?: { data?: D[K] }): Promise<WizardStep<K, D[K], C, S>>;
  back(): Promise<WizardStep<S, unknown, C, S>>;
};
```

### Phase 3: Wizard Factory Integration

**File**: `src/wizard-factory.ts` (MODIFY)
```typescript
export function createWizardFactory<C, E = never>() {
  return {
    createWizard<TDefs extends Record<string, any>>(
      context: C,
      steps: TDefs
    ): EnhancedWizard<C, keyof TDefs & string, DataMapFromDefs<TDefs>, E> {
      // Implementation with enhanced typing
    }
  };
}
```

### Phase 4: Implementation Details

**Key Implementation Patterns**:

1. **Step Wrapper Class**:
```typescript
class WizardStepImpl<StepName, Data, Context, AllSteps>
  implements WizardStep<StepName, Data, Context, AllSteps> {

  constructor(
    private wizard: Wizard<Context, AllSteps, any, any>,
    public readonly name: StepName,
    public readonly data: Readonly<Data> | undefined,
    public readonly context: Readonly<Context>
  ) {}

  markIdle(): WizardStep<StepName, Data, Context, AllSteps> {
    this.wizard.markIdle(this.name);
    return new WizardStepImpl(
      this.wizard,
      this.name,
      this.wizard.getStepData(this.name),
      this.wizard.getContext()
    );
  }
  // ... other methods
}
```

2. **Type-Safe Data Access**:
```typescript
// Extract data type from step definitions
type ExtractStepDataType<TDefs, StepName> =
  TDefs[StepName] extends { data: infer D } ? D
  : TDefs[StepName] extends { validate: (args: { data: infer D }) => any } ? D
  : unknown;
```

3. **Enhanced getCurrent Implementation**:
```typescript
getCurrent(): WizardStep<S, D[S], C, S> {
  const current = store.state.step;
  const data = store.state.data[current] as D[S];
  return new WizardStepImpl(this, current, data, store.state.context);
}
```

## 🧪 Validation Gates

### TypeScript Compilation
```bash
npx tsc --noEmit --strict
```

### Type Inference Tests
```bash
npx vitest run src/tests/enhanced-typing.test.ts
```

### Integration Tests
```bash
npx vitest run src/tests/fluent-api.test.ts
```

### Specific Validation Cases

**Test File**: `src/tests/enhanced-typing.test.ts` (NEW)
```typescript
describe('Enhanced Typing', () => {
  it('should properly type getCurrent().data', () => {
    const current = wizard.getCurrentStep();
    // Type assertion: data should be properly typed, not unknown
    expectTypeOf(current.data).toEqualTypeOf<{ value: number } | undefined>();
  });

  it('should properly type getStepData', () => {
    const step = wizard.getStep('step1');
    expectTypeOf(step.data).toEqualTypeOf<{ value: number } | undefined>();
  });

  it('should enable fluent chaining', () => {
    const result = wizard.getStep('step1').markIdle().markLoading();
    expectTypeOf(result).toMatchTypeOf<WizardStep<'step1', any, any, any>>();
  });
});
```

## 📚 Reference Implementation Examples

### Before (Current State)
```typescript
const { defineSteps, createWizard } = wizardWithContext({ globalFlag: true });

const wizard = createWizard(steps);
const current = wizard.getCurrent(); // data: unknown
const stepData = wizard.getStepData('step1'); // unknown

wizard.markIdle('step1'); // void
wizard.next(); // Promise<void>
```

### After (Enhanced Implementation)
```typescript
const { defineSteps, createWizard } = wizardWithContext({ globalFlag: true });

const wizard = createWizard(steps);
const current = wizard.getCurrentStep(); // data: properly typed
const step = wizard.getStep('step1'); // properly typed step object

const nextStep = step.markIdle().markLoading().next(); // fluent chaining
const navigated = wizard.next(); // returns step object
```

## 🚨 Critical Implementation Considerations

### Backward Compatibility
- Maintain existing `Wizard` interface
- Extend with `EnhancedWizard` interface
- Ensure all existing method signatures continue to work

### Performance Implications
- Step wrapper objects should be lightweight
- Avoid creating unnecessary object instances
- Consider object pooling for frequently accessed steps

### Type System Limitations
- Handle TypeScript's conditional type inference limitations
- Provide escape hatches for complex scenarios
- Ensure proper type narrowing in method chains

### Error Handling
- Maintain proper error propagation in fluent chains
- Ensure type safety is preserved during error states
- Provide meaningful error messages for type mismatches

## 📋 Implementation Task List

### Core Infrastructure
1. [ ] Create `src/step-wrapper.ts` with `WizardStep` interface and implementation
2. [ ] Update `src/types.ts` with `EnhancedWizard` type definitions
3. [ ] Add proper type extraction utilities for step data inference

### Wizard Enhancement
4. [ ] Modify `src/wizard.ts` to implement enhanced return types
5. [ ] Update navigation methods to return step objects
6. [ ] Implement step wrapper creation in wizard methods

### Factory Integration
7. [ ] Update `src/wizard-factory.ts` to return `EnhancedWizard`
8. [ ] Ensure proper type flow from factory to wizard to steps
9. [ ] Update `wizardWithContext` helper accordingly

### Testing & Validation
10. [ ] Create comprehensive type inference tests
11. [ ] Add fluent API integration tests
12. [ ] Update existing tests for backward compatibility
13. [ ] Add hover tests for IDE type checking verification

### Documentation & Examples
14. [ ] Update API documentation with new fluent patterns
15. [ ] Create migration guide for existing users
16. [ ] Add usage examples for the enhanced API

## 🎯 Success Criteria

### Functional Requirements
- ✅ `wizard.getCurrentStep().data` returns properly typed data
- ✅ `wizard.getStep('stepName')` returns typed step object
- ✅ Fluent chaining works: `step.markIdle().markLoading()`
- ✅ Navigation methods return step objects
- ✅ Backward compatibility maintained

### Type Safety Requirements
- ✅ All return types properly inferred
- ✅ Method chaining preserves type information
- ✅ IDE provides proper IntelliSense and autocomplete
- ✅ Type errors caught at compile time

### Performance Requirements
- ✅ No significant performance regression
- ✅ Memory usage remains reasonable
- ✅ Step object creation is optimized

## 🔗 External References

**TypeScript Patterns**:
- [Fluent Interfaces in TypeScript](https://shaky.sh/fluent-interfaces-in-typescript/)
- [TypeScript Advanced Types](https://www.typescriptlang.org/docs/handbook/advanced-types.html)
- [Building Fluent Interfaces with Generics](https://medium.com/@bensammons/building-a-fluent-interface-with-typescript-using-generics-in-typescript-3-4d206f00dba5)

**State Machine Patterns**:
- [XState Documentation](https://xstate.js.org/)
- [TypeScript State Machines](https://medium.com/@floyd.may/building-a-typescript-state-machine-cc9e55995fa8)

**Method Chaining Best Practices**:
- [Fluent APIs Using Method Chaining](https://medium.com/trabe/fluent-apis-using-method-chaining-in-javascript-81b2f03b1700)
- [TypeScript Function Chaining](https://www.typescriptlang.org/play/javascript/functions-with-javascript/function-chaining.ts.html)

---

## 📊 PRP Confidence Score: 8/10

**Reasoning**:
- ✅ Clear problem definition with specific examples
- ✅ Comprehensive research and reference patterns
- ✅ Detailed implementation blueprint with type definitions
- ✅ Concrete validation gates and test strategies
- ✅ Consideration of backward compatibility and performance
- ⚠️ Complexity of TypeScript type inference may require iteration
- ⚠️ Fluent API design requires careful balance of functionality vs. complexity

**Risk Mitigation**: The implementation follows established patterns and leverages existing factory infrastructure. The phased approach allows for incremental validation and refinement.
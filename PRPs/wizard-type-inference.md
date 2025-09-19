# PRP: Wizard Type Inference Implementation

## Overview
Enhance the `@wizard/core` library to support automatic type inference from step definitions while maintaining backward compatibility with explicit type annotations. This enables developers to define wizards with minimal type boilerplate while preserving full type safety.

## Context & Resources

### Existing Implementation
- **Current Type System**: `packages/core/src/types.ts` - Lines 27-69 define `WizardConfig<C,S,D,E>`
- **Step Definitions**: `packages/core/src/types.ts` - Lines 78-130 define `StepDefinition<C,S,Data,E>`
- **Wizard Factory**: `packages/core/src/wizard/createWizard.ts` - Main factory function
- **Zod Integration**: `packages/core/src/zod.ts` - Existing Zod validator helpers

### TypeScript Concepts Required
1. **Conditional Types with `infer`**: https://www.typescriptlang.org/docs/handbook/2/conditional-types.html
2. **`satisfies` Operator (TS 4.9+)**: https://refine.dev/blog/typescript-satisfies-operator/
3. **Mapped Types**: https://www.typescriptlang.org/docs/handbook/2/mapped-types.html
4. **Generic Constraints**: https://www.typescriptlang.org/docs/handbook/2/generics.html

### Design Patterns
- **Builder Pattern**: Progressive type refinement through method chaining
- **Type Inference Through Return Types**: Using function return types to infer data shapes
- **Schema-as-Type-Source**: Leveraging Zod schemas for type extraction

## Requirements

### User Stories
1. **As a developer**, I want to create a wizard without explicit type parameters and have TypeScript infer the types from my configuration
2. **As a developer**, I want to use Zod schemas for validation that also define the step data types
3. **As a developer**, I want backward compatibility so existing explicitly-typed wizards continue to work

### Technical Requirements
1. Support both explicit and inferred type modes
2. Infer step names from object keys
3. Infer data types from:
   - Zod schema in `validate` function
   - Return type of `load` function
   - Type assertion in step definition
4. Maintain full type safety and autocomplete
5. No breaking changes to existing API

## Implementation Blueprint

### Phase 1: Type Inference System

```typescript
// New type utilities in packages/core/src/types.ts

// Extract step names from config
type InferSteps<T> = T extends { steps: infer S }
  ? keyof S extends string ? keyof S : never
  : never;

// Extract data type from step definition
type InferStepData<T> =
  T extends { validate: (data: unknown) => asserts data is infer D } ? D :
  T extends { load: () => infer D | Promise<infer D> } ? D :
  T extends { data?: infer D } ? D :
  unknown;

// Build data map from steps
type InferDataMap<T> = T extends { steps: infer S }
  ? { [K in keyof S]: InferStepData<S[K]> }
  : never;

// Extract context from config
type InferContext<T> = T extends { initialContext: infer C } ? C : {};
```

### Phase 2: Enhanced Step Definition

```typescript
// Modified StepDefinition to support inference hints
export type StepDefinitionInfer<Data = unknown> = {
  // Zod validation that defines type
  validate?: ((data: unknown) => asserts data is Data) |
             { parse: (data: unknown) => Data };

  // Load function that returns typed data
  load?: () => Data | Promise<Data>;

  // Explicit data type hint
  data?: Data;

  // Next steps
  next: string[] | ((args: any) => string | string[]);

  // Other existing properties...
};
```

### Phase 3: Overloaded createWizard Function

```typescript
// packages/core/src/wizard/createWizard.ts

// Overload 1: Explicit types (backward compatible)
export function createWizard<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(config: WizardConfig<C, S, D, E>): Wizard<C, S, D, E>;

// Overload 2: Inferred types
export function createWizard<
  T extends {
    initialStep: string;
    initialContext?: any;
    steps: Record<string, any>;
  }
>(config: T): Wizard<
  InferContext<T>,
  InferSteps<T>,
  InferDataMap<T>,
  never
>;

// Implementation
export function createWizard(config: any): any {
  // Existing implementation unchanged
  // Type inference happens at compile time
}
```

### Phase 4: Zod Integration Enhancement

```typescript
// packages/core/src/zod.ts

// Helper to create step with Zod validation
export function zodStep<T>(
  schema: z.ZodSchema<T>,
  definition: Omit<StepDefinitionInfer<T>, 'validate'>
): StepDefinitionInfer<T> {
  return {
    ...definition,
    validate: createZodValidator(schema)
  };
}

// Type extractor for use in step definitions
export function inferData<T>(data: T): T {
  return data;
}
```

## Implementation Tasks

### Task 1: Create Type Inference Utilities
1. Add inference types to `packages/core/src/types.ts`
2. Test with various step configurations
3. Ensure no regression in explicit type mode

### Task 2: Enhance Step Definition Types
1. Create `StepDefinitionInfer` type variant
2. Update existing `StepDefinition` to extend new type
3. Maintain backward compatibility

### Task 3: Implement createWizard Overloads
1. Add overload signatures to `createWizard`
2. Test inference with different configurations
3. Verify autocomplete works correctly

### Task 4: Improve Zod Integration
1. Create `zodStep` helper function
2. Add `inferData` utility
3. Update documentation with examples

### Task 5: Add Comprehensive Tests
1. Test explicit type mode (existing tests should pass)
2. Test inferred type mode with various patterns
3. Test mixed mode scenarios
4. Test TypeScript compilation and inference

### Task 6: Update Documentation
1. Add inference examples to README
2. Create migration guide
3. Document best practices

## Example Usage After Implementation

```typescript
// Fully inferred types
const wizard = createWizard({
  initialStep: 'info',
  initialContext: { userId: '123' },
  steps: {
    info: {
      next: ['payment'],
      load: () => ({ name: '', email: '' } as InfoData)
    },
    payment: zodStep(paymentSchema, {
      next: ['confirm']
    }),
    confirm: {
      next: [],
      data: {} as { agreed: boolean }
    }
  }
});

// TypeScript knows:
// - Steps are: 'info' | 'payment' | 'confirm'
// - wizard.getStepData('info') returns InfoData
// - wizard.getStepData('payment') returns z.infer<typeof paymentSchema>
```

## Validation Gates

```bash
# Syntax and style check
cd packages/core && npx eslint . --fix

# TypeScript compilation
cd packages/core && npx tsc --noEmit

# Run existing tests (should all pass)
cd packages/core && npm test

# Build the package
cd packages/core && npm run build

# Test in example project
cd examples/basic-form-wizard
npm install
npx tsc --noEmit
npm run dev
```

## Risk Mitigation

1. **Breaking Changes**: Use function overloads to maintain backward compatibility
2. **Complex Types**: Provide escape hatches with explicit types when needed
3. **Performance**: Type inference is compile-time only, no runtime impact
4. **IDE Support**: Test with VS Code and WebStorm for autocomplete
5. **Documentation**: Provide clear examples of both patterns

## Success Criteria

1. ✅ Existing wizards with explicit types continue to work
2. ✅ New wizards can be created without type parameters
3. ✅ Full type safety and autocomplete in both modes
4. ✅ Zod schemas can define step data types
5. ✅ All existing tests pass
6. ✅ Documentation includes clear examples

## Implementation Order

1. **Phase 1**: Type inference utilities (low risk, foundation)
2. **Phase 2**: Enhanced step definitions (backward compatible)
3. **Phase 3**: createWizard overloads (main feature)
4. **Phase 4**: Zod integration improvements (nice-to-have)
5. **Phase 5**: Documentation and examples
6. **Phase 6**: Testing and validation

## Notes for AI Agent

- Start with the type inference utilities in `packages/core/src/types.ts`
- Maintain backward compatibility at all costs
- Test frequently with `npx tsc --noEmit` to catch type errors early
- Reference the existing Zod integration pattern in `packages/core/src/zod.ts`
- Use the example in `update-features.md` as the acceptance criteria
- The TanStack Store uses generics extensively - follow similar patterns
- Focus on developer experience with good autocomplete support

## Confidence Score: 8/10

**Rationale**:
- Strong existing foundation with clear type architecture
- Well-defined requirements with concrete examples
- TypeScript's inference capabilities are sufficient for this use case
- Backward compatibility approach minimizes risk
- Clear validation gates ensure correctness

**Risk Factors**:
- Complex type inference may hit TypeScript limits in edge cases (-1)
- IDE autocomplete behavior may vary across editors (-1)
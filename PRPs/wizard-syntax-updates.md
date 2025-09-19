# PRP: Wizard Syntax Updates - Move Step Attributes from Wizard to Step Level

## Overview
Refactor the wizard configuration API to move step-specific attributes (`isOptional`, `isRequired`, `isStepComplete`, `prerequisites`, `weights`) from the wizard-level configuration to individual step definitions. This creates a more intuitive and maintainable API where step properties are colocated with their step definitions.

## Context & Resources

### Current Implementation Analysis

#### Current Structure (Wizard Level)
```typescript
// packages/core/src/types.ts (lines 52-64)
type WizardConfig = {
  // Current wizard-level attributes (TO BE REMOVED)
  weights?: Partial<Record<S, number>>;
  prerequisites?: Partial<Record<S, readonly S[]>>;
  isStepComplete?: (args: { step: S; data: Partial<D>; ctx: Readonly<C> }) => boolean;
  isOptional?: (step: S, ctx: Readonly<C>) => boolean;
  isRequired?: (step: S, ctx: Readonly<C>) => boolean;
}
```

#### Target Structure (Step Level)
```typescript
type StepDefinition = {
  // NEW step-level attributes
  required?: boolean | ((ctx: C) => boolean);        // Default: true
  complete?: boolean | ((data: Data | undefined, ctx: C) => boolean);  // Default: check if data exists
  prerequisites?: S[];        // Default: []
  weight?: number | ((ctx: C) => number);           // Default: 1
}
```

### Files Requiring Updates

#### Core Types & Definitions
- `packages/core/src/types.ts` - Update WizardConfig and StepDefinition types
- `packages/core/src/selectors.ts` - Update selectors to read from step definitions
- `packages/core/src/helpers/requirements.ts` - Update requirement checks
- `packages/core/src/helpers/progress.ts` - Update weight calculations
- `packages/core/src/helpers/availability.ts` - Update prerequisite checks
- `packages/core/src/helpers/createHelpers.ts` - Update helper functions

#### Tests
- `packages/core/src/helpers.test.ts` - Update test configurations (lines 83-86, 129, 143-144, 181-183, 200, 235, 356, 371-373)

#### Documentation
- `packages/docs/pages/api-reference.mdx`
- `packages/docs/pages/getting-started.mdx`
- `packages/docs/pages/helpers/*.mdx` (requirements, progress, availability)
- `packages/docs/pages/api-docs/core.mdx`

### Design Decisions

1. **Static vs Dynamic Values**: Support both boolean/number and function types for flexibility
   - `required`: Boolean for static requirement, function for context-dependent
   - `complete`: Boolean for static state, function for dynamic validation
   - `weight`: Number for static weight, function for context-dependent weighting

2. **Default Values**:
   - `required`: true (most steps are required by default)
   - `complete`: false or check if data exists
   - `prerequisites`: [] (no dependencies by default)
   - `weight`: 1 (equal weight by default)

3. **Function Evaluation Timing**:
   - `required`: Evaluated when checking step requirements
   - `complete`: Evaluated when checking step completion status
   - `weight`: Evaluated when calculating progress

4. **Migration Strategy**: Support both old and new syntax temporarily with deprecation warnings

## Requirements

### Functional Requirements
1. Move step attributes from wizard config to individual step definitions
2. Maintain backward compatibility during transition period
3. Update all selectors and helpers to use new structure
4. Preserve existing functionality and behavior

### Non-Functional Requirements
1. Clear deprecation warnings for old syntax
2. Minimal performance impact
3. Type-safe migration path
4. Comprehensive test coverage

## Implementation Blueprint

### Phase 1: Update Type Definitions

```typescript
// packages/core/src/types.ts

// Add new step-level properties to StepDefinition
export type StepDefinition<C, S extends string, Data, E> = {
  // Existing properties...

  /** Whether this step is required (default: true) */
  required?: boolean | ((ctx: Readonly<C>) => boolean);

  /** Custom completion check or static state */
  complete?: boolean | ((data: Data | undefined, ctx: Readonly<C>) => boolean);

  /** Steps that must be completed before this step */
  prerequisites?: S[];

  /** Weight for progress calculation (default: 1) */
  weight?: number | ((ctx: Readonly<C>) => number);
}

// Mark old wizard-level properties as deprecated
export type WizardConfig<...> = {
  // ... existing properties ...

  /** @deprecated Use step.weight instead */
  weights?: Partial<Record<S, number>>;

  /** @deprecated Use step.prerequisites instead */
  prerequisites?: Partial<Record<S, readonly S[]>>;

  /** @deprecated Use step.complete instead */
  isStepComplete?: (args: { step: S; data: Partial<D>; ctx: Readonly<C> }) => boolean;

  /** @deprecated Use step.required instead */
  isOptional?: (step: S, ctx: Readonly<C>) => boolean;

  /** @deprecated Use step.required instead */
  isRequired?: (step: S, ctx: Readonly<C>) => boolean;
}
```

### Phase 2: Update Selectors with Backward Compatibility

```typescript
// packages/core/src/selectors.ts

export const isRequired = <...>(config, state, step) => {
  const stepDef = config.steps[step];

  // Check new step-level property first
  if (stepDef && 'required' in stepDef) {
    const required = stepDef.required;
    if (typeof required === 'function') {
      return required(state.context);
    }
    return required !== false; // Default true for boolean
  }

  // Fallback to deprecated wizard-level (with warning)
  if (config.isRequired) {
    console.warn('isRequired at wizard level is deprecated. Use step.required instead.');
    return config.isRequired(step, state.context);
  }
  if (config.isOptional) {
    console.warn('isOptional at wizard level is deprecated. Use step.required instead.');
    return !config.isOptional(step, state.context);
  }

  return true; // Default: required
};

export const isStepComplete = <...>(config, state, step) => {
  const stepDef = config.steps[step];
  const stepData = state.data[step];

  // Check new step-level property
  if (stepDef && 'complete' in stepDef) {
    if (typeof stepDef.complete === 'boolean') {
      return stepDef.complete;
    }
    if (typeof stepDef.complete === 'function') {
      return stepDef.complete(stepData, state.context);
    }
  }

  // Fallback to deprecated wizard-level
  if (config.isStepComplete) {
    console.warn('isStepComplete at wizard level is deprecated. Use step.complete instead.');
    return config.isStepComplete({ step, data: state.data, ctx: state.context });
  }

  // Default: check if data exists
  return stepData != null;
};
```

### Phase 3: Update Helper Functions

```typescript
// packages/core/src/helpers/requirements.ts

const prerequisitesMet = (step: S): boolean => {
  const stepDef = config.steps[step];

  // Check new step-level prerequisites
  if (stepDef?.prerequisites) {
    return stepDef.prerequisites.every(isStepComplete);
  }

  // Fallback to deprecated wizard-level
  const prereqs = config.prerequisites?.[step];
  if (prereqs) {
    console.warn('prerequisites at wizard level is deprecated. Use step.prerequisites instead.');
    return prereqs.every(isStepComplete);
  }

  return true; // No prerequisites
};

// packages/core/src/helpers/progress.ts

const getStepWeight = (step: S, context: C): number => {
  const stepDef = config.steps[step];

  // Check new step-level weight
  if (stepDef?.weight !== undefined) {
    const weight = stepDef.weight;
    if (typeof weight === 'function') {
      return weight(context);
    }
    return weight;
  }

  // Fallback to deprecated wizard-level
  if (config.weights?.[step] !== undefined) {
    console.warn('weights at wizard level is deprecated. Use step.weight instead.');
    return config.weights[step];
  }

  return 1; // Default weight
};
```

### Phase 4: Add Migration Helper

```typescript
// packages/core/src/utils/migrate.ts

export function migrateWizardConfig<C, S extends string, D extends Record<S, unknown>, E>(
  config: WizardConfig<C, S, D, E>
): WizardConfig<C, S, D, E> {
  const migrated = { ...config };

  // Migrate weights
  if (config.weights) {
    Object.entries(config.weights).forEach(([step, weight]) => {
      if (migrated.steps[step as S]) {
        migrated.steps[step as S].weight = weight;
      }
    });
    delete migrated.weights;
  }

  // Migrate prerequisites
  if (config.prerequisites) {
    Object.entries(config.prerequisites).forEach(([step, prereqs]) => {
      if (migrated.steps[step as S]) {
        migrated.steps[step as S].prerequisites = prereqs as S[];
      }
    });
    delete migrated.prerequisites;
  }

  // Migrate isOptional/isRequired to step.required
  if (config.isOptional || config.isRequired) {
    Object.keys(config.steps).forEach((step) => {
      const isOpt = config.isOptional?.(step as S, {} as C);
      const isReq = config.isRequired?.(step as S, {} as C);

      if (isOpt !== undefined) {
        migrated.steps[step as S].required = !isOpt;
      } else if (isReq !== undefined) {
        migrated.steps[step as S].required = isReq;
      }
    });
    delete migrated.isOptional;
    delete migrated.isRequired;
  }

  return migrated;
}
```

## Implementation Tasks

### Task 1: Update Type Definitions
1. Add new properties to `StepDefinition` type
2. Mark old properties in `WizardConfig` as deprecated
3. Add JSDoc comments explaining the migration

### Task 2: Update Selectors with Compatibility
1. Update `isRequired` selector to check step-level first
2. Update `isOptional` selector to use `!step.required`
3. Update `isStepComplete` to check step.complete
4. Update `prerequisitesMet` to check step.prerequisites
5. Add deprecation warnings for old syntax

### Task 3: Update Helper Functions
1. Update `requirements.ts` helper functions
2. Update `progress.ts` to use step.weight
3. Update `availability.ts` prerequisite checks
4. Update `createHelpers.ts` to use new structure

### Task 4: Create Migration Utilities
1. Create `migrateWizardConfig` helper function
2. Add documentation for migration
3. Create codemod script for automated migration

### Task 5: Update Tests
1. Update test configurations to use new syntax
2. Add tests for backward compatibility
3. Add tests for migration helper
4. Ensure all existing tests still pass

### Task 6: Update Documentation
1. Update API reference with new syntax
2. Add migration guide
3. Update all examples in docs
4. Update type documentation

### Task 7: Update React Package
1. Ensure React wrapper works with new syntax
2. Add any necessary type updates
3. Test with example apps

## Testing Strategy

### Unit Tests
```typescript
describe('Step-level attributes', () => {
  it('should use step.required when defined as boolean', () => {
    const wizard = createWizard({
      steps: {
        step1: {
          next: ['step2'],
          required: false
        }
      }
    });
    expect(wizard.helpers.isRequired('step1')).toBe(false);
  });

  it('should use step.required when defined as function', () => {
    const wizard = createWizard({
      initialContext: { userRole: 'admin' },
      steps: {
        step1: {
          next: ['step2'],
          required: (ctx) => ctx.userRole !== 'admin'
        }
      }
    });
    expect(wizard.helpers.isRequired('step1')).toBe(false);
  });

  it('should use step.complete as function', () => {
    const wizard = createWizard({
      steps: {
        step1: {
          next: [],
          complete: (data, ctx) => !!data && data.value > ctx.threshold
        }
      }
    });
    wizard.setStepData('step1', { value: 10 });
    expect(wizard.helpers.isStepComplete('step1')).toBe(true);
  });

  it('should use step.weight as function', () => {
    const wizard = createWizard({
      initialContext: { priority: 'high' },
      steps: {
        step1: {
          next: [],
          weight: (ctx) => ctx.priority === 'high' ? 3 : 1
        }
      }
    });
    const progress = wizard.helpers.progress();
    // Weight should be 3 for high priority
  });

  it('should support backward compatibility with isOptional', () => {
    const wizard = createWizard({
      isOptional: (step) => step === 'step1',
      steps: { step1: { next: [] } }
    });
    expect(wizard.helpers.isRequired('step1')).toBe(false);
  });

  it('should prefer step-level over wizard-level', () => {
    const wizard = createWizard({
      isOptional: () => true,
      steps: {
        step1: {
          next: [],
          required: true
        }
      }
    });
    expect(wizard.helpers.isRequired('step1')).toBe(true);
  });
});
```

## Validation Gates

```bash
# Type checking
cd packages/core && npx tsc --noEmit

# Run tests
cd packages/core && npm test

# Build package
cd packages/core && npm run build

# Test in example app
cd examples/basic-form-wizard && npm run dev

# Check documentation build
cd packages/docs && npm run build
```

## Migration Guide

### Before (Wizard Level)
```typescript
const wizard = createWizard({
  initialStep: 'step1',
  weights: { step2: 2, step3: 3 },
  prerequisites: { step3: ['step1', 'step2'] },
  isOptional: (step) => step === 'step2',
  isStepComplete: ({ step, data }) => !!data[step]?.completed,
  steps: {
    step1: { next: ['step2'] },
    step2: { next: ['step3'] },
    step3: { next: [] }
  }
});
```

### After (Step Level)
```typescript
const wizard = createWizard({
  initialStep: 'step1',
  steps: {
    step1: {
      next: ['step2'],
      required: true,
      weight: 1
    },
    step2: {
      next: ['step3'],
      required: false,  // Was isOptional
      weight: 2
    },
    step3: {
      next: [],
      prerequisites: ['step1', 'step2'],
      weight: 3,
      complete: (data) => !!data?.completed
    }
  }
});
```

### Dynamic Values Example
```typescript
const wizard = createWizard({
  initialStep: 'step1',
  initialContext: { userRole: 'guest', difficulty: 'hard' },
  steps: {
    step1: {
      next: ['step2'],
      // Required only for non-admin users
      required: (ctx) => ctx.userRole !== 'admin',
      // Weight based on difficulty
      weight: (ctx) => ctx.difficulty === 'hard' ? 3 : 1
    },
    step2: {
      next: ['step3'],
      // Complete when all fields are filled
      complete: (data, ctx) => {
        return data?.name && data?.email &&
               (ctx.userRole === 'admin' || data?.verified);
      }
    },
    step3: {
      next: [],
      prerequisites: ['step1', 'step2'],
      // Dynamic weight based on context
      weight: (ctx) => ctx.userRole === 'premium' ? 2 : 1
    }
  }
});
```

## Risk Mitigation

1. **Breaking Changes**: Provide backward compatibility with deprecation warnings
2. **Migration Complexity**: Provide automated migration helper and clear documentation
3. **Performance**: No runtime impact, only compile-time changes
4. **Type Safety**: Ensure all type definitions are properly updated
5. **Testing**: Comprehensive test coverage for both old and new syntax

## Success Criteria

1. ✅ Step attributes can be defined at step level
2. ✅ Old wizard-level syntax still works with deprecation warnings
3. ✅ All existing tests pass
4. ✅ Documentation updated with new syntax
5. ✅ Migration guide and helper available
6. ✅ React package works with new syntax

## Notes for AI Agent

- Start with type definitions in `packages/core/src/types.ts`
- Ensure backward compatibility at every step
- Add deprecation warnings using `console.warn` in development only
- Test frequently to ensure no regressions
- The selectors and helpers are the most critical parts to update carefully
- Remember to handle undefined/null checks for optional properties
- Default values are important: `required: true`, `weight: 1`, `prerequisites: []`
- When checking function types, use `typeof value === 'function'` before calling
- Pass the correct context when evaluating functions (`state.context` for most cases)
- For `complete` function, pass both `data` (which may be undefined) and `context`
- For `required` and `weight` functions, pass only `context`

## External Resources

- TypeScript Handbook on Deprecation: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-0.html#deprecated
- JavaScript Optional Chaining: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Optional_chaining
- React Hooks Migration Guide (for reference): https://react.dev/learn/react-compiler

## Confidence Score: 9/10

**Rationale**:
- Clear migration path with backward compatibility
- Well-defined type changes
- Comprehensive understanding of all affected files
- Clear testing strategy
- Minimal risk with deprecation approach

**Minor Risk**:
- Documentation updates may miss some edge cases (-1)
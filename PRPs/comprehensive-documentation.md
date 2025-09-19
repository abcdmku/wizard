# PRP: Comprehensive Documentation for WizardOpus

## Mission
Document all undocumented functionality in @wizard/core and @wizard/react packages with detailed examples ranging from basic to complex usage patterns.

## Context & Current State

### Codebase Structure
- **Monorepo** using pnpm workspaces with TypeScript
- **Core Package** (`packages/core/`): Headless wizard logic, state management, helpers
- **React Package** (`packages/react/`): React hooks and provider components
- **Docs Package** (`packages/docs/`): Nextra-based documentation site
- **Examples** (`examples/`): Working implementation examples

### Documentation Framework
- **Technology**: Next.js + Nextra theme (MDX format)
- **Location**: `packages/docs/pages/`
- **Build Command**: `pnpm --filter docs dev`
- **Existing Structure**:
  - `index.mdx` - Landing page
  - `getting-started.mdx` - Basic setup
  - `concepts.mdx` - Core concepts
  - `api-reference.mdx` - API documentation
  - `react.mdx` - React integration

## Identified Documentation Gaps

### Critical Undocumented Features

#### 1. **Zod Integration Module** (`packages/core/src/zod.ts`)
- `createZodValidator()` - Schema-based validation
- `createContextualZodValidator()` - Context-aware validation
- `InferSchema<T>` - Type extraction helper
- No examples of Zod integration in documentation

#### 2. **Helpers Module** (`packages/core/src/helpers/`)
Complete helper system is largely undocumented:
- **Navigation Helpers**: Complex navigation patterns
- **Progress Helpers**: `percentCompletePerStep`, weight calculations
- **Availability Helpers**: `refreshAvailability()`, caching behavior
- **Requirements Helpers**: DAG prerequisites validation
- **Diagnostics Helpers**: `stepAttempts`, `stepDuration`, performance metrics

#### 3. **Runtime Status System** (`packages/core/src/wizard/runtimeMarkers.ts`)
- Status lifecycle: `idle`, `loading`, `error`, `terminated`, `skipped`
- `onStatusChange` callback configuration
- Error retry patterns with attempt tracking
- Runtime vs computed status differentiation

#### 4. **Router Integration Issues** (`packages/react/src/router.ts`)
Current documentation shows incorrect API:
```typescript
// DOCUMENTED (WRONG)
{ getCurrentPath, navigate, getStepFromPath, getPathFromStep }

// ACTUAL API
{ param, toStep, toUrl, navigate, getParam }
```

#### 5. **Advanced Configuration Patterns**
- Complex DAG prerequisites with circular dependency detection
- Dynamic `next` function with conditional branching
- Weight-based progress calculation
- Custom `isStepComplete` logic

#### 6. **Type System Documentation**
- `StepMeta` type usage
- `WizardTransitionEvent<C, S, D, E>` structure
- Generic type constraints and relationships
- Type-safe event patterns

## Implementation Blueprint

### Phase 1: Foundation Documentation

1. **Create Helpers Documentation Section**
   ```
   packages/docs/pages/helpers/
   ├── index.mdx          # Overview and categories
   ├── navigation.mdx     # Navigation helpers
   ├── progress.mdx       # Progress tracking
   ├── availability.mdx   # Step availability
   ├── requirements.mdx   # Prerequisites
   └── diagnostics.mdx    # Performance metrics
   ```

2. **Add Zod Integration Guide**
   ```
   packages/docs/pages/validation/
   ├── index.mdx          # Validation overview
   ├── zod-integration.mdx # Complete Zod guide
   └── custom-validators.mdx # Custom validation
   ```

3. **Fix Router Integration Documentation**
   - Update `packages/docs/pages/react.mdx` with correct API
   - Add TanStack Router specific examples
   - Include React Router v6 patterns

### Phase 2: Advanced Patterns & Examples

4. **Create Advanced Patterns Section**
   ```
   packages/docs/pages/advanced/
   ├── status-system.mdx    # Runtime status management
   ├── error-handling.mdx   # Error patterns and retries
   ├── dag-prerequisites.mdx # Complex prerequisites
   ├── dynamic-flow.mdx     # Conditional branching
   └── performance.mdx      # Optimization strategies
   ```

5. **Add Interactive Examples**
   ```
   packages/docs/components/examples/
   ├── ZodValidationExample.tsx
   ├── HelpersPlayground.tsx
   ├── StatusSystemDemo.tsx
   └── RouterIntegrationDemo.tsx
   ```

### Phase 3: API Reference Enhancement

6. **Complete API Documentation**
   - Add missing type definitions
   - Document all exported functions
   - Include parameter descriptions
   - Add return type documentation

7. **Create Recipe Collection**
   ```
   packages/docs/pages/recipes/
   ├── form-wizard.mdx        # Multi-step forms
   ├── onboarding-flow.mdx    # User onboarding
   ├── checkout-process.mdx   # E-commerce checkout
   ├── survey-wizard.mdx      # Dynamic surveys
   └── file-upload-wizard.mdx # Multi-file uploads
   ```

## Implementation Tasks

### Task List (In Order)

1. **Research & Analysis** [2 hours]
   - Read all source files in packages/core/src/helpers/
   - Analyze Zod integration implementation
   - Study runtime markers system
   - Review router integration code

2. **Documentation Structure** [1 hour]
   - Create new documentation folders
   - Update navigation in `packages/docs/theme.config.tsx`
   - Set up MDX templates for consistency

3. **Helpers Documentation** [4 hours]
   - Write comprehensive helper guides
   - Create code examples for each helper category
   - Add performance considerations
   - Include common use cases

4. **Zod Integration Guide** [3 hours]
   - Document all Zod functions
   - Create validation examples (basic to complex)
   - Show context-aware validation patterns
   - Add type inference examples

5. **Router Integration Fix** [2 hours]
   - Correct existing documentation
   - Add proper TanStack Router examples
   - Include React Router v6 patterns
   - Show URL synchronization

6. **Status System Documentation** [3 hours]
   - Explain status lifecycle
   - Document error handling patterns
   - Show retry mechanisms
   - Add troubleshooting guide

7. **Advanced Patterns** [4 hours]
   - Document DAG prerequisites
   - Show dynamic flow examples
   - Add performance optimization guide
   - Include memory management tips

8. **Interactive Examples** [3 hours]
   - Create live code playgrounds
   - Add interactive demos
   - Include editable examples
   - Show real-world scenarios

9. **API Reference Update** [2 hours]
   - Complete all type documentation
   - Add missing function descriptions
   - Include edge cases
   - Add migration notes

10. **Recipe Collection** [3 hours]
    - Create 5+ complete recipes
    - Include full code examples
    - Add explanations and variations
    - Show integration patterns

## Code Examples to Include

### Example 1: Zod Validation (Basic)
```typescript
import { createWizard, createZodValidator } from '@wizard/core';
import { z } from 'zod';

const UserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  age: z.number().min(18)
});

const wizard = createWizard({
  steps: {
    userInfo: {
      load: createZodValidator(UserSchema),
      // ... rest of step config
    }
  }
});
```

### Example 2: Complex Helpers Usage
```typescript
const helpers = createHelpers(wizard);

// Progress tracking
const progress = helpers.progress.percentCompletePerStep();
console.log('Step completion:', progress);

// Diagnostics
const attempts = helpers.diagnostics.stepAttempts('payment');
const duration = helpers.diagnostics.stepDuration('userInfo');

// Navigation with prerequisites check
const canNavigate = helpers.navigation.canNavigateTo('checkout');
if (canNavigate) {
  await helpers.navigation.goTo('checkout');
}

// Availability management
await helpers.availability.refreshAvailability();
const available = helpers.availability.isAvailable('premium');
```

### Example 3: Runtime Status Management
```typescript
const wizard = createWizard({
  onStatusChange: (step, status, prevStatus) => {
    console.log(`Step ${step}: ${prevStatus} → ${status}`);

    if (status === 'error') {
      // Custom error handling
      trackError(step);
    }
  },
  steps: {
    payment: {
      load: async (data) => {
        // Automatic status management
        // Status: idle → loading
        const result = await processPayment(data);
        // Status: loading → idle (success) or error (failure)
        return result;
      },
      maxRetries: 3, // Retry on error
      retryDelay: 1000
    }
  }
});
```

## External Resources & Documentation

### Reference Documentation
- TanStack Store: https://tanstack.com/store/latest
- Zod Documentation: https://zod.dev/
- TanStack Router: https://tanstack.com/router/latest
- React Router v6: https://reactrouter.com/en/main
- Nextra Documentation: https://nextra.site/

### Similar Libraries for Inspiration
- React Hook Form Multi-Step: https://react-hook-form.com/advanced-usage#wizard
- Formik Multi-Step: https://formik.org/docs/examples/wizard
- React Use Wizard: https://github.com/devrnt/react-use-wizard

## Validation Gates

```bash
# 1. Build documentation site
cd packages/docs
pnpm build

# 2. Type checking
pnpm tsc --noEmit

# 3. Link validation
pnpm --filter docs analyze

# 4. Example validation
cd examples
for dir in */; do
  echo "Testing $dir"
  cd "$dir"
  pnpm install
  pnpm build
  cd ..
done

# 5. Documentation linting
pnpm --filter docs lint

# 6. Test interactive examples
pnpm --filter docs test

# 7. Check for broken links
npx linkinator https://localhost:3000 --recurse

# 8. Validate code examples compile
npx tsx scripts/validate-examples.ts
```

## Success Criteria

1. **Coverage**: 100% of exported functions have documentation
2. **Examples**: Each feature has at least 3 examples (basic, intermediate, advanced)
3. **Clarity**: No ambiguous type definitions or parameter descriptions
4. **Completeness**: All identified gaps are addressed
5. **Accuracy**: Router integration documentation matches actual implementation
6. **Usability**: Interactive examples work without errors
7. **Searchability**: All features are indexed and searchable

## Common Pitfalls to Avoid

1. **Don't mix old/new router API** - Ensure complete accuracy
2. **Don't skip helper categories** - Document all helper functions
3. **Don't use outdated patterns** - Reference current codebase
4. **Don't forget TypeScript generics** - Show type inference examples
5. **Don't ignore edge cases** - Document error states and limitations

## File References for Pattern Matching

### Existing Documentation Patterns
- Simple example: `packages/docs/pages/getting-started.mdx`
- API reference: `packages/docs/pages/api-docs/core.mdx`
- Interactive demo: `packages/docs/components/Playground.tsx`
- Recipe format: `packages/docs/pages/recipes.mdx`

### Code to Document
- Helpers: `packages/core/src/helpers/*.ts`
- Zod: `packages/core/src/zod.ts`
- Status: `packages/core/src/wizard/runtimeMarkers.ts`
- Router: `packages/react/src/router.ts`
- Types: `packages/core/src/types.ts`

## Quality Score: 8/10

**Confidence Level**: High confidence for one-pass implementation

**Rationale**:
- ✅ Complete context provided with file locations
- ✅ Clear implementation blueprint with folder structure
- ✅ Specific code examples included
- ✅ Validation gates are executable
- ✅ External resources linked for reference
- ✅ Common pitfalls identified
- ⚠️ May need minor adjustments based on Nextra theme specifics
- ⚠️ Interactive component implementation details may vary

This PRP provides comprehensive context for documenting all undocumented features in WizardOpus with clear implementation steps and validation criteria.
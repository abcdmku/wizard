# PRP: Factory Pattern Refactor for All Wizard Examples

## Mission
Refactor all wizard examples to use the factory pattern (`wizardWithContext` or `createWizardFactory`) for better type inference and complete the remaining unimplemented examples using this pattern. Ensure all examples follow clean code principles and demonstrate their specific features clearly.

## Context & Current State

### Codebase Analysis
- **Monorepo** using pnpm workspaces with TypeScript
- **Core Package** (`packages/core/`): Provides `wizardWithContext` and `createWizardFactory` for context-aware wizards
- **React Package** (`packages/react/`): React hooks and provider
- **Current Examples Status**:
  - **Completed but need refactoring**:
    - `basic-form-wizard` - Currently uses `createWizard` directly
    - `advanced-branching` - Currently uses `createWizard` directly
    - `persistence-local` - Currently uses `createWizard` directly
    - `node-saga-wizard` - Needs checking
    - `react-router-wizard` - Needs checking
  - **Not yet implemented**:
    - `router-guard` - Partially started (only setup files)
    - `zod-validation` - Not started

### Factory Pattern Benefits
The factory pattern provides:
1. **Better Type Inference**: Context types are properly inferred in all callbacks
2. **Cleaner API**: `wizardWithContext` eliminates the need to pass context twice
3. **Type Safety**: All step callbacks get properly typed `context`, `data`, and helper parameters
4. **Consistency**: Single pattern across all examples

### Pattern Comparison

#### Old Pattern (direct createWizard):
```typescript
import { createWizard, defineSteps } from "@wizard/core";

const steps = defineSteps({
  step1: {
    data: { value: "" },
    next: ["step2"],
    beforeExit: ({ context, data }) => {
      // Context type must be manually asserted or cast
    }
  }
});

export const wizard = createWizard({
  context: { userId: "" },
  steps
});
```

#### New Pattern (factory pattern with destructuring):
```typescript
import { wizardWithContext } from "@wizard/core";

type AppContext = {
  userId: string;
};

const { defineSteps, step, createWizard } = wizardWithContext<AppContext>({
  userId: ""
});

const steps = defineSteps({
  step1: step({
    data: { value: "" },
    next: ["step2"],
    beforeExit: ({ context, data }) => {
      // Context is automatically typed as AppContext
      // Data is automatically inferred
    }
  })
});

export const wizard = createWizard(steps);
```

## Research Findings

### Core Package Exports
From `packages/core/src/index.ts`:
- `createWizardFactory` - Creates a factory with context type
- `wizardWithContext` - Convenience function that returns factory methods
- `step`, `stepWithValidation`, `dataStep`, `transitionStep`, `conditionalStep` - Helper functions

### Existing Test Examples
From `packages/core/src/tests/factory-step-test.ts`:
```typescript
const factory = createWizardFactory<AppContext>();
const { defineSteps, step, createWizard } = factory;
const steps = defineSteps({
  step1: step({
    data: { enabled: true, value: 42 },
    canEnter: ({ context, data }) => {
      // All parameters properly typed
      return context.globalFlag && data.enabled;
    }
  })
});
const wizard = createWizard(context, steps);
```

From `packages/core/src/tests/context-inference-test.ts`:
```typescript
const { defineSteps, createWizard, step } = wizardWithContext<AppContext>({
  userId: 'test',
  globalFlag: false
});
```

### Clean Code Guidelines (from refactor.md)
- **File Size**: Keep files under 150 lines
- **Function Size**: Keep functions under 20 lines
- **App.tsx**: Should be under 50 lines (ideally under 15)
- **No `any` types**: Use proper TypeScript types
- **Separation**: UI components separate from business logic
- **Organization**: Group by feature (wizard/, components/, hooks/)

## Implementation Blueprint

### Phase 1: Refactor Existing Examples

#### 1.1 basic-form-wizard
```typescript
// wizard/factory.ts
import { wizardWithContext } from "@wizard/core";
import type { WizardContext } from "./types";

export const { defineSteps, step, createWizard } = wizardWithContext<WizardContext>({
  totalSteps: 3,
  completedSteps: [] as string[]
});

// wizard/config.ts
import { defineSteps, step, createWizard } from "./factory";
import { validateAccount, validatePersonal, validateAddress } from "./validation";

const steps = defineSteps({
  account: step({
    validate: validateAccount,
    data: { email: "", password: "", confirmPassword: "" },
    next: ["personal"],
    meta: { label: "Account", iconKey: "user" }
  }),
  personal: step({
    validate: validatePersonal,
    data: { firstName: "", lastName: "", dateOfBirth: "" },
    next: ["address"],
    meta: { label: "Personal", iconKey: "person" }
  }),
  address: step({
    validate: validateAddress,
    data: { street: "", city: "", state: "", zipCode: "", country: "" },
    next: [],
    meta: { label: "Address", iconKey: "location" }
  })
});

export const formWizard = createWizard(steps);
```

#### 1.2 advanced-branching
```typescript
// wizard/factory.ts
import { wizardWithContext } from "@wizard/core";
import type { WizardContext } from "./types";

export const { defineSteps, step, createWizard } = wizardWithContext<WizardContext>({
  role: 'user' as UserRole,
  completedSteps: [] as string[],
  requiresApproval: false
});

// wizard/config.ts
import { defineSteps, step, createWizard } from "./factory";
import { determineNextStep, canAccessStep } from "./navigation";

const steps = defineSteps({
  roleSelection: step({
    data: { role: 'user' },
    next: ({ data, context }) => determineNextStep('roleSelection', data.role, context),
    beforeExit: ({ data, updateContext }) => {
      updateContext((ctx) => {
        ctx.role = data.role;
        ctx.completedSteps.push('roleSelection');
      });
    },
    meta: { label: 'Select Role' }
  }),
  // ... other steps with proper step() usage
});
```

#### 1.3 persistence-local
```typescript
// wizard/factory.ts
import { wizardWithContext } from "@wizard/core";
import type { WizardContext } from "./types";
import { storageAdapter } from "../utils/persistence";

export const { defineSteps, step, createWizard } = wizardWithContext<WizardContext>({
  resumeData: {},
  isDirty: false,
  autoSaveEnabled: true,
  recoveredFromStorage: false
});

// wizard/config.ts
import { defineSteps, step, createWizard } from "./factory";
import { storageAdapter } from "../utils/persistence";

const steps = defineSteps({
  personal: step({
    data: { /* ... */ },
    next: ["experience"],
    beforeExit: async ({ context, updateContext }) => {
      if (context.autoSaveEnabled && context.isDirty) {
        await storageAdapter.save(context.resumeData);
        updateContext(ctx => {
          ctx.isDirty = false;
          ctx.lastAutoSave = new Date();
        });
      }
    }
  }),
  // ... other steps
});

export const resumeWizard = createWizard(steps, {
  onInit: async (ctx) => {
    const savedData = await storageAdapter.load();
    if (savedData) {
      return { ...ctx, resumeData: savedData, recoveredFromStorage: true };
    }
    return ctx;
  }
});
```

### Phase 2: Complete Missing Examples

#### 2.1 router-guard
```typescript
// wizard/factory.ts
import { wizardWithContext } from "@wizard/core";
import type { GuardContext } from "./types";

export const { defineSteps, step, createWizard } = wizardWithContext<GuardContext>({
  isAuthenticated: false,
  hasUnsavedChanges: false,
  lockedSteps: [] as string[],
  completedSteps: [] as string[]
});

// wizard/config.ts
import { defineSteps, step, createWizard } from "./factory";

const steps = defineSteps({
  introduction: step({
    data: { agreed: false },
    next: ["authentication"],
    canExit: ({ data }) => data.agreed,
    meta: { label: "Welcome", protected: false }
  }),
  authentication: step({
    data: { username: "", password: "", verified: false },
    next: ["secureData"],
    canExit: ({ data, context }) => {
      if (!data.verified) {
        return window.confirm("You haven't verified. Continue anyway?");
      }
      return true;
    },
    beforeExit: ({ data, updateContext }) => {
      if (data.verified) {
        updateContext(ctx => { ctx.isAuthenticated = true; });
      }
    },
    meta: { label: "Login", protected: false }
  }),
  secureData: step({
    data: { /* sensitive data */ },
    canEnter: ({ context }) => context.isAuthenticated,
    next: ["confirmation"],
    meta: { label: "Secure Area", protected: true }
  }),
  confirmation: step({
    data: { confirmed: false },
    canExit: () => false, // Can't go back after confirming
    next: [],
    meta: { label: "Final", protected: true }
  })
});

export const guardedWizard = createWizard(steps);
```

#### 2.2 zod-validation
```typescript
// wizard/factory.ts
import { wizardWithContext } from "@wizard/core";
import type { ValidationContext } from "./types";

export const { defineSteps, step, createWizard } = wizardWithContext<ValidationContext>({
  validationErrors: {} as Record<string, string[]>,
  isValidating: false,
  validationMode: 'onSubmit' as 'onChange' | 'onBlur' | 'onSubmit'
});

// wizard/schemas.ts
import { z } from "zod";

export const emailSchema = z.object({
  email: z.string().email("Invalid email").refine(
    async (email) => {
      const response = await checkEmailAvailability(email);
      return response.available;
    },
    { message: "Email already registered" }
  ),
  confirmEmail: z.string().email()
}).refine(
  data => data.email === data.confirmEmail,
  { message: "Emails don't match", path: ["confirmEmail"] }
);

// wizard/config.ts
import { defineSteps, step, createWizard } from "./factory";
import { createZodValidator } from "@wizard/core";
import * as schemas from "./schemas";

const steps = defineSteps({
  emailVerification: step({
    data: { email: "", confirmEmail: "" },
    validate: createZodValidator(schemas.emailSchema),
    next: ["passwordCreation"],
    beforeExit: ({ data, updateContext }) => {
      updateContext(ctx => {
        delete ctx.validationErrors['emailVerification'];
      });
    }
  }),
  // ... other steps with Zod validation
});

export const validatedWizard = createWizard(steps);
```

## Implementation Tasks

### Phase 1: Refactor Existing Examples (Priority 1)

1. **basic-form-wizard**
   - [ ] Create `wizard/factory.ts` with `wizardWithContext` and destructure methods
   - [ ] Refactor `wizard/config.ts` to use destructured `step()` function
   - [ ] Update all step callbacks to leverage typed context
   - [ ] Verify type inference in all callbacks
   - [ ] Run validation gates

2. **advanced-branching**
   - [ ] Create `wizard/factory.ts` with proper context type
   - [ ] Refactor dynamic navigation with factory pattern
   - [ ] Update all conditional logic with typed context
   - [ ] Test role-based branching
   - [ ] Verify guards work with new pattern

3. **persistence-local**
   - [ ] Create `wizard/factory.ts` with persistence context
   - [ ] Refactor auto-save logic with typed context
   - [ ] Update onInit and onTransition hooks
   - [ ] Test save/load functionality
   - [ ] Verify debouncing still works

4. **node-saga-wizard**
   - [ ] Check current implementation
   - [ ] Create factory if not using it
   - [ ] Update saga handlers with typed context
   - [ ] Test CLI interactions

5. **react-router-wizard**
   - [ ] Check current implementation
   - [ ] Create factory if needed
   - [ ] Update router sync logic
   - [ ] Test navigation

### Phase 2: Complete Missing Examples (Priority 2)

6. **router-guard**
   - [ ] Complete project setup (continue from partial)
   - [ ] Create factory with guard context
   - [ ] Implement canEnter/canExit with typed guards
   - [ ] Add unsaved changes warning
   - [ ] Create protected route wrapper
   - [ ] Test all guard scenarios
   - [ ] Write README

7. **zod-validation**
   - [ ] Set up new project with Vite
   - [ ] Create factory with validation context
   - [ ] Implement comprehensive Zod schemas
   - [ ] Add async validation examples
   - [ ] Create real-time validation hooks
   - [ ] Test all validation scenarios
   - [ ] Write README

## Validation Gates

```bash
# For each example, run these checks:

# 1. TypeScript compilation - no errors
pnpm --filter @examples/{example-name} tsc --noEmit

# 2. Build successfully
pnpm --filter @examples/{example-name} build

# 3. Linting passes
pnpm --filter @examples/{example-name} lint

# 4. File size checks
echo "Checking file sizes..."
find examples/{example-name}/src -name "*.tsx" -o -name "*.ts" | while read file; do
  lines=$(wc -l < "$file")
  if [ $lines -gt 150 ]; then
    echo "❌ $file has $lines lines (max 150)"
    exit 1
  fi
done

# 5. App.tsx is minimal
lines=$(wc -l < examples/{example-name}/src/App.tsx)
if [ $lines -gt 50 ]; then
  echo "❌ App.tsx has $lines lines (max 50)"
  exit 1
fi

# 6. No 'any' types
if grep -r "any" examples/{example-name}/src --include="*.ts" --include="*.tsx" | grep -v "// eslint-disable"; then
  echo "❌ Found 'any' types"
  exit 1
fi

# 7. Factory pattern usage
if ! grep -q "wizardWithContext\|createWizardFactory" examples/{example-name}/src/wizard/; then
  echo "❌ Not using factory pattern"
  exit 1
fi

# 8. Test functionality
pnpm --filter @examples/{example-name} dev
# Manual testing checklist:
# - [ ] All navigation paths work
# - [ ] Context is properly typed (hover over callbacks)
# - [ ] Feature-specific functionality works
# - [ ] No console errors
```

## Code Patterns & Examples

### Pattern 1: Simple Factory Setup
```typescript
// wizard/factory.ts
import { wizardWithContext } from "@wizard/core";
import type { MyContext } from "./types";

const initialContext: MyContext = {
  // ... initial values
};

export const { defineSteps, step, createWizard } = wizardWithContext<MyContext>(initialContext);
```

### Pattern 2: Factory with Options
```typescript
// wizard/config.ts
import { defineSteps, step, createWizard } from "./factory";

const steps = defineSteps({
  // ... step definitions
});

export const wizard = createWizard(steps, {
  id: 'my-wizard',
  initial: 'firstStep',
  onInit: async (ctx) => {
    // Initialize context
    return ctx;
  },
  onTransition: async (ctx, { from, to }) => {
    // Handle transitions
    return ctx;
  },
  persistence: {
    key: 'wizard-state',
    storage: localStorage
  }
});
```

### Pattern 3: Step with Full Type Safety
```typescript
import { defineSteps, step } from "./factory";

const steps = defineSteps({
  myStep: step({
    data: { field1: "", field2: 0 },
    next: ({ data, context }) => {
      // Both data and context are fully typed
      if (context.someFlag && data.field2 > 10) {
        return ["specialStep"];
      }
      return ["normalStep"];
    },
    canEnter: ({ context, from }) => {
      // All parameters typed
      return context.isAuthorized;
    },
    canExit: async ({ data, to }) => {
      // Async guards supported
      return await validateData(data);
    },
    beforeEnter: ({ data, updateContext }) => {
      // Can return partial data updates
      return { field1: "default" };
    },
    beforeExit: ({ data, updateContext }) => {
      updateContext(ctx => {
        ctx.lastCompletedStep = 'myStep';
      });
    },
    validate: ({ data }) => {
      if (!data.field1) throw new Error("Field1 required");
    },
    meta: { label: "My Step", icon: "📝" }
  })
});
```

### Pattern 4: Dynamic Steps
```typescript
// For examples like advanced-branching
import { defineSteps, step } from "./factory";

const determineSteps = (role: UserRole): string[] => {
  switch(role) {
    case 'admin': return ['adminStep', 'reviewStep'];
    case 'user': return ['userStep', 'reviewStep'];
    default: return ['reviewStep'];
  }
};

const steps = defineSteps({
  roleSelect: step({
    data: { role: 'user' as UserRole },
    next: ({ data }) => determineSteps(data.role)
  })
});
```

## External Resources

### Documentation URLs
- **TypeScript Handbook - Generics**: https://www.typescriptlang.org/docs/handbook/2/generics.html
- **TypeScript - Type Inference**: https://www.typescriptlang.org/docs/handbook/type-inference.html
- **Zod Documentation**: https://zod.dev/
- **React Router v6 Guards**: https://reactrouter.com/en/main/route/route#loader
- **Vite Documentation**: https://vitejs.dev/guide/
- **pnpm Workspaces**: https://pnpm.io/workspaces

### Reference Files in Codebase
- **Factory Implementation**: `packages/core/src/wizard-factory.ts`
- **Factory Tests**: `packages/core/src/tests/factory-step-test.ts`
- **Context Test**: `packages/core/src/tests/context-inference-test.ts`
- **Type Definitions**: `packages/core/src/types.ts`
- **Clean Code Guide**: `.claude/commands/refactor.md`

## Success Criteria

### Type Safety
- [ ] All examples use factory pattern
- [ ] Context is properly typed in all callbacks
- [ ] No `any` types anywhere
- [ ] Full IntelliSense support in callbacks

### Code Quality
- [ ] All files under 150 lines
- [ ] App.tsx under 50 lines
- [ ] Functions under 20 lines
- [ ] Clear separation of concerns
- [ ] Consistent naming conventions

### Functionality
- [ ] All examples work as intended
- [ ] Features are clearly demonstrated
- [ ] No runtime errors
- [ ] Smooth user experience

### Documentation
- [ ] Each example has README
- [ ] Code includes helpful comments
- [ ] Complex logic explained
- [ ] Usage patterns documented

## Notes for AI Implementation

### Important Guidelines
1. **Start with factory creation** - Always create the factory first in `wizard/factory.ts`
2. **Destructure factory methods** - Use `const { defineSteps, step, createWizard } = wizardWithContext<Context>(...)`
3. **Use step() directly** - Wrap all step definitions with the destructured `step()` function
4. **Test type inference** - Hover over callbacks to verify types
5. **Keep commits atomic** - One example per commit
6. **Run validation gates** - After each example is complete
7. **Preserve functionality** - Ensure features still work after refactoring

### Common Pitfalls to Avoid
1. **Don't mix patterns** - Use either `wizardWithContext` OR `createWizardFactory`, not both
2. **Don't forget generics** - Always specify context type: `wizardWithContext<MyContext>`
3. **Don't ignore validation** - Run all gates before moving to next example
4. **Don't skip tests** - Manually test each feature after refactoring

### Refactoring Checklist (per example)
- [ ] Read current implementation
- [ ] Identify context shape and create types
- [ ] Create factory with typed context
- [ ] Wrap all steps with factory.step()
- [ ] Update all callbacks to use typed parameters
- [ ] Remove any type assertions or casts
- [ ] Run TypeScript compilation
- [ ] Run build and lint
- [ ] Check file sizes
- [ ] Test functionality manually
- [ ] Update README if needed
- [ ] Commit changes

## Priority Order

1. **Highest Priority**: Refactor existing examples to factory pattern
   - basic-form-wizard
   - advanced-branching
   - persistence-local
   - node-saga-wizard
   - react-router-wizard

2. **High Priority**: Complete missing examples with factory pattern
   - router-guard (partially started)
   - zod-validation (not started)

3. **Final**: Validation and documentation
   - Run all validation gates
   - Update main examples README
   - Ensure consistency across all examples

## Confidence Score: 9/10

High confidence due to:
- Clear factory pattern examples in test files
- Well-defined type system in core package
- Existing working examples to reference
- Comprehensive validation gates
- Clear implementation patterns

Minor uncertainty (-1) for:
- Exact behavior of some edge cases in complex scenarios
- Potential breaking changes in existing examples during refactoring

## Summary

This PRP provides a comprehensive plan to:
1. Refactor all existing wizard examples to use the factory pattern for better type inference
2. Complete the remaining unimplemented examples using the factory pattern
3. Ensure all examples follow clean code principles
4. Maintain clear demonstration of each feature

The factory pattern (`wizardWithContext` or `createWizardFactory`) provides superior type inference, making the wizard callbacks fully typed without manual type assertions. This leads to better developer experience, fewer bugs, and cleaner code.
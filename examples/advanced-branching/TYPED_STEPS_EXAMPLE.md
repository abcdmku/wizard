# Using Type-Safe Step Builder

If you want TypeScript to validate that `next` arrays only contain valid step names, you can use the `createStepBuilder` method:

## Option 1: Using createStepBuilder (Type-Safe)

```typescript
import { reactWizardWithContext } from "@wizard/react";

const { createStepBuilder, defineSteps, createWizard } = reactWizardWithContext<WizardContext>({
  role: 'user',
  requiresApproval: false,
  completedSteps: []
});

// First, define your step names as a type
type StepName =
  | 'roleSelection'
  | 'userProfile'
  | 'adminPanel'
  | 'managerDashboard'
  | 'sharedReview'
  | 'sendReminder';

// Create a typed step builder
const step = createStepBuilder<StepName>();

// Now TypeScript will validate step names in next arrays!
export const steps = defineSteps({
  roleSelection: step({
    data: { role: 'user' },
    next: ['userProfile', 'adminPanel'], // ✅ Autocomplete works!
    // next: ['invalidStep'], // ❌ TypeScript error!
  }),
  userProfile: step({
    data: {},
    next: ['sharedReview'], // ✅ Valid
  }),
  // ... other steps
});
```

## Option 2: Using Regular step() (No Validation)

```typescript
import { reactWizardWithContext } from "@wizard/react";

const { step, defineSteps, createWizard } = reactWizardWithContext<WizardContext>({
  role: 'user',
  requiresApproval: false,
  completedSteps: []
});

// This works but doesn't validate step names
export const steps = defineSteps({
  roleSelection: step({
    data: { role: 'user' },
    next: ['userProfile', 'adminPanel'], // ⚠️ No validation
  }),
});
```

## Benefits of createStepBuilder

1. **Autocomplete**: Get IntelliSense suggestions for valid step names
2. **Compile-time safety**: TypeScript errors if you reference non-existent steps
3. **Refactoring**: Renaming steps automatically updates all references
4. **Documentation**: Types serve as documentation for your wizard's flow

## Trade-offs

- **Pros**: Type safety, autocomplete, refactoring support
- **Cons**: Need to maintain the `StepName` type separately

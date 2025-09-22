# Context Type Inference Solution

## Problem

When defining wizard steps, the context type should be inferred from the `createWizard()` call, but TypeScript cannot automatically flow this type through to step callback parameters.

## Solution: Wizard Factory Pattern

Use the **wizard factory pattern** to provide context-aware step definitions:

### ✅ New Recommended Approach

```typescript
import { createWizardFactory } from '@wizard/core';

// 1. Define your context type
type AppContext = {
  globalFlag: boolean;
  userId: string;
  permissions: string[];
  theme: 'light' | 'dark';
};

// 2. Create a factory with your context type
const factory = createWizardFactory<AppContext>();

// 3. Define steps using factory.step() for automatic context typing
const steps = factory.defineSteps({
  profile: factory.step({
    data: { name: '', email: '' },
    canEnter: ({ context, data }) => {
      // ✅ context is automatically typed as AppContext!
      const hasPermission = context.permissions.includes('profile:edit');
      const isEnabled = context.globalFlag;
      const hasData = data?.name && data?.email;

      return hasPermission && isEnabled && hasData;
    },
    beforeExit: ({ context, data, updateContext }) => {
      // ✅ All parameters properly typed without explicit annotations!
      const name: string = data.name;
      const userId: string = context.userId;

      updateContext((ctx) => {
        // ✅ ctx is typed as AppContext
        ctx.userId = name;
        ctx.permissions.push('profile:updated');
      });
    },
    next: ['settings']
  }),

  settings: factory.step({
    data: { notifications: true, theme: 'light' as const },
    beforeExit: ({ context, data, updateContext }) => {
      // ✅ Again, all properly typed automatically
      const theme = data.theme;
      const currentTheme = context.theme;

      updateContext((ctx) => {
        ctx.theme = theme;
      });
    },
    next: []
  })
});

// 4. Create the wizard with context
const wizard = factory.createWizard(
  {
    globalFlag: true,
    userId: 'user123',
    permissions: ['profile:edit'],
    theme: 'light'
  },
  steps
);
```

### Alternative: wizardWithContext Helper

For a more concise API:

```typescript
import { wizardWithContext } from '@wizard/core';

const { defineSteps, createWizard } = wizardWithContext<AppContext>({
  globalFlag: true,
  userId: 'user123',
  permissions: ['read'],
  theme: 'light'
});

const steps = defineSteps({
  step1: factory.step({
    data: { value: 42 },
    canEnter: ({ context, data }) => {
      // ✅ context automatically typed as AppContext
      return context.globalFlag && Boolean(data?.value);
    },
    next: []
  })
});

const wizard = createWizard(steps);
```

## Key Benefits

1. **No Explicit Typing**: Context type flows automatically from factory creation
2. **Type Safety**: Full IntelliSense and type checking in callbacks
3. **Clean API**: No need to repeatedly specify context types
4. **Backward Compatible**: Works alongside existing `defineSteps()` and helper functions

## Migration Guide

### From Old Approach
```typescript
// ❌ Old: Manual explicit typing
const steps = defineSteps({
  step1: {
    beforeExit: ({
      context,
      data
    }: {
      context: AppContext;
      data: { value: number };
    }) => {
      // ...
    }
  }
});

const wizard = createWizard({ context: myContext, steps });
```

### To New Approach
```typescript
// ✅ New: Automatic inference
const factory = createWizardFactory<AppContext>();

const steps = factory.defineSteps({
  step1: factory.step({
    data: { value: 42 },
    beforeExit: ({ context, data }) => {
      // ✅ Both automatically typed!
    },
    next: []
  })
});

const wizard = factory.createWizard(myContext, steps);
```

## Technical Details

The factory pattern works by:
1. Capturing the context type `C` at factory creation
2. Providing a `factory.step()` method that pre-types all callback signatures with `C`
3. Using TypeScript's function parameter inference for the step definition

This bypasses the TypeScript limitation with conditional type inference in destructured parameters by providing the type information directly to the function signature.
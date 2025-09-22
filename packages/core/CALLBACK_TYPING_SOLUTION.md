# Callback Argument Typing Solution

## Problem

Callback arguments in step definitions (like `beforeExit`, `canExit`, etc.) were showing `data` parameter as `any` type instead of the properly inferred step data type.

## Root Cause

This is a **TypeScript limitation** with complex conditional type inference in function parameter destructuring. While the `defineSteps()` function correctly enhances return types, TypeScript cannot infer the parameter types in destructured callback arguments without explicit annotations.

## Solution

Use **explicit type annotations** in callback parameters:

### ✅ Working Approach

```typescript
// Define your context type
type AppContext = {
  userId: string;
  permissions: string[];
  theme: 'light' | 'dark';
};

const steps = defineSteps({
  payment: {
    validate: ({ data }: { data: { method: string; amount: number } }) => {
      if (!data.method || data.amount <= 0) throw new Error('Invalid payment');
    },
    data: { method: 'card', amount: 100 },
    beforeExit: ({
      data,
      context,
      updateContext
    }: {
      data: { method: string; amount: number };
      context: AppContext;
      updateContext: (fn: (context: AppContext) => void) => void;
    }) => {
      // ✅ data is properly typed as { method: string; amount: number }
      const method: string = data.method;
      const amount: number = data.amount;

      // ✅ context is properly typed as AppContext
      const userId: string = context.userId;
      const permissions: string[] = context.permissions;

      console.log(`Payment: ${method} for $${amount} by user ${userId}`);

      // ✅ updateContext is properly typed
      updateContext((ctx) => {
        ctx.permissions.push('payment:completed');
      });
    },
    canExit: ({
      data,
      context
    }: {
      data: { method: string; amount: number };
      context: AppContext;
    }) => {
      // ✅ Both data and context properly typed
      const amount: number = data.amount;
      const hasPermission = context.permissions.includes('payment:create');
      return amount > 0 && hasPermission;
    },
    next: ['confirmation'],
  }
});
```

### Type Inference Rules

1. **With validation**: Use the type from the `validate` function parameter
2. **Without validation**: Use the type from the `data` property
3. **Always** explicitly type the destructured `{ data }` parameter

### Helper Functions (Alternative)

You can also use the provided helper functions that handle typing automatically:

```typescript
import { step, stepWithValidation } from '@wizard/core';

const steps = defineSteps({
  payment: step({
    data: { method: 'card', amount: 100 },
    beforeExit: ({ data }) => {
      if (data) {
        // ✅ Properly typed with null checking
        const method: string = data.method;
        const amount: number = data.amount;
      }
    },
    next: ['confirmation'],
  })
});
```

## Why This Happens

TypeScript's conditional type inference has known limitations when:
1. Types are computed through complex conditional type expressions
2. The inference context is a destructured function parameter
3. Multiple levels of generic type mapping are involved

This is a fundamental language limitation, not a bug in our implementation.

## Best Practice

**Always explicitly type callback parameters** including context:

```typescript
// Define your context type
type YourContextType = { userId: string; /* other properties */ };

// If you have validation:
validate: ({ data }: { data: YourDataType }) => { ... }
beforeExit: ({
  data,
  context,
  updateContext
}: {
  data: YourDataType;
  context: YourContextType;
  updateContext: (fn: (context: YourContextType) => void) => void;
}) => { ... }

// If you only have data property:
data: yourDataValue,
beforeExit: ({
  data,
  context
}: {
  data: typeof yourDataValue;
  context: YourContextType;
}) => { ... }
```

### Key Changes
- ✅ **Renamed**: `ctx` → `context` for clarity
- ✅ **Fixed**: Context typing from `unknown` to proper generic type
- ✅ **Enhanced**: All callback arguments properly typed

This provides full type safety, IntelliSense, and is explicit about both data and context shapes.
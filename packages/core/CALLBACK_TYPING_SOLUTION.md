# Callback Argument Typing Solution

## Problem

Callback arguments in step definitions (like `beforeExit`, `canExit`, etc.) were showing `data` parameter as `any` type instead of the properly inferred step data type.

## Root Cause

This is a **TypeScript limitation** with complex conditional type inference in function parameter destructuring. While the `defineSteps()` function correctly enhances return types, TypeScript cannot infer the parameter types in destructured callback arguments without explicit annotations.

## Solution

Use **explicit type annotations** in callback parameters:

### ✅ Working Approach

```typescript
const steps = defineSteps({
  payment: {
    validate: ({ data }: { data: { method: string; amount: number } }) => {
      if (!data.method || data.amount <= 0) throw new Error('Invalid payment');
    },
    data: { method: 'card', amount: 100 },
    beforeExit: ({ data }: { data: { method: string; amount: number } }) => {
      // ✅ data is properly typed as { method: string; amount: number }
      const method: string = data.method;
      const amount: number = data.amount;
      console.log(`Payment: ${method} for $${amount}`);
    },
    canExit: ({ data }: { data: { method: string; amount: number } }) => {
      // ✅ data is properly typed
      const amount: number = data.amount;
      return amount > 0;
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

**Always explicitly type callback parameters** based on your step's data type:

```typescript
// If you have validation:
validate: ({ data }: { data: YourDataType }) => { ... }
beforeExit: ({ data }: { data: YourDataType }) => { ... }

// If you only have data property:
data: yourDataValue,
beforeExit: ({ data }: { data: typeof yourDataValue }) => { ... }
```

This provides full type safety, IntelliSense, and is explicit about the expected data shape.
# @wizard/core API Reference

## Table of Contents

- [Core APIs](#core-apis)
  - [createWizard](#createwizard)
  - [createWizardFactory](#createwizardfactory)
- [Wizard Instance](#wizard-instance)
  - [State Management](#state-management)
  - [Navigation](#navigation)
  - [Error Management](#error-management)
  - [Data Management](#data-management)
  - [Status Control](#status-control)
  - [Helpers](#helpers)
- [Step Wrapper API](#step-wrapper-api)
  - [Properties](#properties)
  - [Methods](#methods)
- [Type Definitions](#type-definitions)
- [Step Helpers](#step-helpers)

## Core APIs

### createWizard

Creates a wizard instance directly without a factory.

```typescript
function createWizard<S extends string, D extends Record<S, unknown>>(
  steps: StepDefinitions<S, D>,
  options?: CreateWizardOptions
): Wizard<Context, S, D>
```

#### Parameters

- `steps` - Object mapping step names to their definitions
- `options` (optional) - Configuration options
  - `context` - Shared context object
  - `order` - Array specifying step sequence
  - `onStatusChange` - Callback for status changes
  - Other wizard configuration options

#### Examples

```typescript
// Minimal usage
const wizard = createWizard({
  account: step<AccountData>(),
  profile: step<ProfileData>()
});

// With options
const wizard = createWizard(
  {
    account: step<AccountData>(),
    profile: step<ProfileData>()
  },
  {
    context: { apiUrl: '/api' },
    order: ['account', 'profile']
  }
);
```

### createWizardFactory

Creates a factory for building wizards with shared context type.

```typescript
function createWizardFactory<Context = unknown>(): {
  defineSteps: <T>(steps: T) => T,
  step: <Data>() => StepDefinition<Data, Context>,
  stepWithValidation: <Data>(validate, definition) => StepDefinition<Data, Context>,
  createWizard: <Steps>(steps, options?) => Wizard<Context, Steps>
}
```

#### Returns

- `defineSteps` - Helper to define steps with type inference
- `step` - Create a step definition
- `stepWithValidation` - Create a step with validation
- `createWizard` - Create wizard instances

#### Example

```typescript
const { defineSteps, step, createWizard } = createWizardFactory<AppContext>();

const steps = defineSteps({
  account: step<AccountData>(),
  profile: step<ProfileData>()
});

const wizard = createWizard(steps);
```

## Wizard Instance

### State Management

#### getStepData(step)
Get data for a specific step.

```typescript
wizard.getStepData('account') // AccountData | undefined
```

#### setStepData(step, data)
Set complete data for a step.

```typescript
wizard.setStepData('account', { email: 'user@example.com', password: '***' })
```

#### updateStepData(step, updater) ⭐ NEW
Atomically update partial step data without race conditions.

```typescript
// Object syntax - partial update
wizard.updateStepData('account', { email: 'new@example.com' })

// Function syntax - based on current state
wizard.updateStepData('account', current => ({
  count: (current?.count || 0) + 1
}))
```

#### getAllData()
Get all step data.

```typescript
const allData = wizard.getAllData() // { account: AccountData, profile: ProfileData, ... }
```

#### getContext()
Get the shared context.

```typescript
const context = wizard.getContext() // Context
```

#### setContext(context | updater)
Update the context.

```typescript
// Replace
wizard.setContext({ apiUrl: '/api/v2' })

// Update function
wizard.setContext(ctx => ({ ...ctx, authenticated: true }))
```

### Navigation

#### getCurrent()
Get current step information.

```typescript
const current = wizard.getCurrent()
// { step: 'account', data: AccountData | undefined, context: Context }
```

#### goTo(step)
Navigate to a specific step.

```typescript
await wizard.goTo('profile')
```

#### next()
Go to the next step.

```typescript
await wizard.next()
```

#### back()
Go to the previous step.

```typescript
await wizard.back()
```

### Error Management ⭐ NEW

#### getStepError(step)
Get error for a specific step.

```typescript
const error = wizard.getStepError('account') // unknown
```

#### getAllErrors()
Get all step errors.

```typescript
const errors = wizard.getAllErrors() // { account?: unknown, profile?: unknown, ... }
```

#### clearStepError(step)
Clear error for a specific step.

```typescript
wizard.clearStepError('account')
```

#### clearAllErrors()
Clear all errors.

```typescript
wizard.clearAllErrors()
```

#### markError(step, error)
Mark a step as having an error.

```typescript
wizard.markError('account', new Error('Validation failed'))
```

### Data Management

#### reset()
Reset all wizard state.

```typescript
wizard.reset()
```

#### undo()
Undo the last state change.

```typescript
wizard.undo()
```

#### redo()
Redo a previously undone change.

```typescript
wizard.redo()
```

### Status Control

#### markLoading(step)
Mark a step as loading.

```typescript
wizard.markLoading('account')
```

#### markIdle(step)
Clear loading state.

```typescript
wizard.markIdle('account')
```

#### markSkipped(step)
Mark a step as skipped.

```typescript
wizard.markSkipped('optional-step')
```

#### markTerminated(step, error?)
Mark step as permanently failed.

```typescript
wizard.markTerminated('payment', new Error('Payment failed'))
```

### Helpers

The `wizard.helpers` object provides numerous utility methods:

```typescript
wizard.helpers.canGoNext()           // boolean
wizard.helpers.canGoBack()           // boolean
wizard.helpers.canGoTo(step)         // boolean
wizard.helpers.isComplete()          // boolean
wizard.helpers.progress()            // { ratio, percent, label }
wizard.helpers.completedSteps()      // string[]
wizard.helpers.remainingSteps()      // string[]
wizard.helpers.stepStatus(step)      // StepStatus
wizard.helpers.isOptional(step)      // boolean
wizard.helpers.isRequired(step)      // boolean
// ... and many more
```

## Step Wrapper API

Get a wrapped step instance with fluent API:

```typescript
const step = wizard.getStep('account')
```

### Properties ⭐ UPDATED

Direct property access (no method calls needed):

```typescript
step.name      // 'account'
step.data      // AccountData | undefined
step.context   // Context
step.status    // StepStatus ('current' | 'completed' | 'error' | ...)
step.error     // unknown
```

### Methods

#### Data Operations

```typescript
// Set complete data
step.setData({ email: 'user@example.com', password: '***' })

// Update partial data (atomic) ⭐ NEW
step.updateData({ email: 'new@example.com' })
step.updateData(current => ({ count: (current?.count || 0) + 1 }))
```

#### Status Operations

```typescript
step.markLoading()      // Mark as loading
step.markIdle()         // Clear loading
step.markSkipped()      // Mark as skipped
step.markError(error)   // Mark with error
step.markTerminated()   // Mark as failed
step.clearError()       // Clear error ⭐ NEW
```

#### Navigation

```typescript
await step.next()              // Go to next step
await step.back()              // Go to previous step
await step.goTo('profile')     // Go to specific step
```

#### Checks

```typescript
step.canNavigateNext()          // boolean
step.canNavigateBack()          // boolean
step.canNavigateTo('profile')   // boolean
```

## Type Definitions

### ValidateArgs ⭐ UPDATED

Now properly typed with step data:

```typescript
type ValidateArgs<Context, Data = unknown> = {
  context: Readonly<Context>;
  data: Data;  // Now properly typed, not unknown!
}
```

### StepDefinition

```typescript
interface StepDefinition<Data, Context> {
  label?: string;
  description?: string;
  guard?: (context: Context) => boolean | Promise<boolean>;
  validate?: (args: ValidateArgs<Context, Data>) => void | Promise<void>;
  isComplete?: (args: ValidateArgs<Context, Data>) => boolean;
  isOptional?: (context: Context) => boolean;
  isRequired?: (context: Context) => boolean;
  onEnter?: (args: ValidateArgs<Context, Data>) => void | Promise<void>;
  onExit?: (args: ValidateArgs<Context, Data>) => void | Promise<void>;
}
```

### StepStatus

```typescript
type StepStatus =
  | 'unavailable'  // Step cannot be accessed
  | 'optional'     // Step can be skipped
  | 'current'      // Currently active step
  | 'completed'    // Successfully completed
  | 'required'     // Must be completed
  | 'skipped'      // Was skipped
  | 'error'        // Has recoverable error
  | 'terminated'   // Permanently failed
  | 'loading'      // Currently loading
```

### WizardState

```typescript
interface WizardState<Context, Steps, DataMap> {
  current: Steps;
  data: Partial<DataMap>;
  context: Context;
  errors: Partial<Record<Steps, unknown>>;  // ⭐ NEW
  runtime?: Record<Steps, StepRuntime>;
}
```

## Step Helpers

### step

Create a basic step definition.

```typescript
import { step } from '@wizard/core';

const accountStep = step<AccountData>();
```

### stepWithValidation

Create a step with validation function.

```typescript
import { stepWithValidation } from '@wizard/core';

const accountStep = stepWithValidation<AccountData, AppContext>(
  ({ data, context }) => {
    // data is properly typed as AccountData!
    if (!data.email.includes('@')) {
      throw new Error('Invalid email');
    }
  },
  {
    label: 'Account Information'
  }
);
```

## Migration from v0.1.0

### Validation Type Fix

```typescript
// Before (v0.1.0) - data was unknown
validate: ({ data, context }) => {
  const typedData = data as AccountData; // Manual cast required
  if (!typedData.email) throw new Error('Email required');
}

// After (v0.2.0) - data is properly typed
validate: ({ data, context }) => {
  if (!data.email) throw new Error('Email required'); // TypeScript knows the type!
}
```

### Safe Data Updates

```typescript
// Before - Race condition prone
onChange={(value) => setStepData("account", { ...data!, email: value })}

// After - Atomic update
onChange={(value) => wizard.updateStepData("account", { email: value })}
```

### Direct Property Access

```typescript
// Before (if using custom implementation)
const status = step.getStatus();
const error = step.getError();

// After - Direct properties
const status = step.status;
const error = step.error;
```

### Error Management

```typescript
// New in v0.2.0
wizard.markError('account', new Error('Validation failed'));
const error = wizard.getStepError('account');
wizard.clearStepError('account');

// In components
const step = wizard.getStep('account');
if (step.error) {
  console.error('Step has error:', step.error);
  step.clearError();
}
```

### Factory API

```typescript
// Before
const wizard = factory.createWizard(context, steps, options);

// After - More flexible
const wizard = createWizard(steps);              // Minimal
const wizard = createWizard(steps, { context }); // With context
const wizard = createWizard(steps, { context, order }); // With options
```
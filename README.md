# 🧙 Wizard - Type-Safe Multi-Step Wizards

A deeply type-safe, isomorphic, headless multi-step wizard library for TypeScript applications. Built with TanStack Store for reactive state management.

## Features

- 🎯 **100% Type-Safe** - Full TypeScript support with deep type inference
- 🔄 **Isomorphic** - Works in Node.js and browsers
- 🎨 **Headless** - Bring your own UI, no style dependencies
- 📦 **Tiny** - ~3-4kb min+gz core (excluding peer deps)
- ⚛️ **React Support** - First-class React hooks and components
- 🔌 **Extensible** - Pluggable validation, persistence, and routing
- 🎮 **Shared Context** - Type-safe context shared across all steps
- ↩️ **History & Undo** - Built-in navigation history support
- 🛡️ **Guards** - Control step entry/exit with async guards
- 🔄 **Async Operations** - Built-in loading states and async hooks

## Installation

```bash
# Core package (framework-agnostic)
pnpm add @wizard/core

# React adapter
pnpm add @wizard/react

# Optional: Zod for validation
pnpm add zod
```

## Quick Start

### 1. Define Your Types

```typescript
import { z } from 'zod';

// Shared context across all steps
type CheckoutContext = {
  userId?: string;
  coupon?: string | null;
  total: number;
};

// Step IDs
type CheckoutSteps = 'account' | 'shipping' | 'payment' | 'review';

// Validation schemas
const accountSchema = z.object({
  email: z.string().email(),
});

const shippingSchema = z.object({
  address: z.string().min(3),
  city: z.string().min(2),
  zipCode: z.string().min(5),
});

// Step data map
type CheckoutDataMap = {
  account: z.infer<typeof accountSchema>;
  shipping: z.infer<typeof shippingSchema>;
  payment: { cardLast4: string };
  review: { agreed: boolean };
};
```

### 2. Create Your Wizard

```typescript
import { createWizard } from '@wizard/core';
import { createZodValidator } from '@wizard/core/zod';

const wizard = createWizard<CheckoutContext, CheckoutSteps, CheckoutDataMap>({
  initialStep: 'account',
  initialContext: { total: 0, coupon: null },
  steps: {
    account: {
      validate: createZodValidator(accountSchema),
      next: ['shipping'],
      beforeExit: async ({ updateContext, data }) => {
        // Update shared context
        updateContext((ctx) => {
          ctx.userId = data.email.toLowerCase();
        });
      },
    },
    shipping: {
      validate: createZodValidator(shippingSchema),
      next: ['payment'],
      canEnter: ({ ctx }) => Boolean(ctx.userId),
    },
    payment: {
      next: ['review'],
      beforeExit: async ({ updateContext }) => {
        // Calculate total
        updateContext((ctx) => {
          ctx.total = 100 + 2.5; // subtotal + fee
        });
      },
    },
    review: {
      next: [],
      canEnter: ({ ctx }) => ctx.total > 0,
    },
  },
});
```

### 3. Use in React

```tsx
import { WizardProvider, useWizard, useWizardStep } from '@wizard/react';

function App() {
  return (
    <WizardProvider wizard={wizard}>
      <CheckoutFlow />
    </WizardProvider>
  );
}

function CheckoutFlow() {
  const step = useWizardStep();
  
  switch (step) {
    case 'account': return <AccountStep />;
    case 'shipping': return <ShippingStep />;
    case 'payment': return <PaymentStep />;
    case 'review': return <ReviewStep />;
  }
}

function AccountStep() {
  const { next } = useWizardActions();
  const [email, setEmail] = useState('');
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    await next({ email });
  };
  
  return (
    <form onSubmit={handleSubmit}>
      <input 
        type="email" 
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button type="submit">Continue</button>
    </form>
  );
}
```

## Core Concepts

### Shared Context

A single typed context object shared across all steps:

```typescript
// Update context from any step
updateContext((ctx) => {
  ctx.userId = 'user123';
  ctx.total = calculateTotal();
});

// Read context in any step
const { userId, total } = useWizardSharedContext();
```

### Guards

Control step navigation with guards:

```typescript
{
  canEnter: ({ ctx }) => ctx.isAuthenticated,
  canExit: ({ ctx, data }) => data.isValid,
}
```

### Async Operations

Built-in support for async operations:

```typescript
{
  load: async ({ setStepData, updateContext }) => {
    const data = await fetchUserData();
    setStepData(data);
  },
  beforeExit: async ({ data, updateContext }) => {
    await saveProgress(data);
  },
}
```

### Persistence

Pluggable persistence interface:

```typescript
{
  persistence: {
    save: (state) => localStorage.setItem('wizard', JSON.stringify(state)),
    load: () => JSON.parse(localStorage.getItem('wizard') || 'null'),
    clear: () => localStorage.removeItem('wizard'),
  }
}
```

## Helpers & Status

The wizard provides a rich set of helper methods and status tracking for building advanced UI:

### Step Statuses

Each step can have one of the following statuses:

```typescript
type StepStatus =
  | 'unavailable'  // Blocked by guards/prereqs
  | 'optional'     // Not required for completion
  | 'current'      // Active step
  | 'completed'    // Finished successfully
  | 'required'     // Must be completed
  | 'skipped'      // Intentionally bypassed
  | 'error'        // Failed but retryable
  | 'terminated'   // Permanently failed
  | 'loading';     // Async work in progress
```

### Using Helpers

```typescript
const { helpers } = wizard;

// Progress bar
const { percent, label } = helpers.progress();
console.log(`Progress: ${percent}% (${label})`);

// Sidebar navigation
for (const step of helpers.orderedSteps()) {
  const status = helpers.stepStatus(step);
  const required = helpers.isRequired(step);
  // Render step with appropriate badge/color
}

// Next button
if (helpers.canGoNext()) {
  await wizard.next();
}

// Jump to next required step
const nextRequired = helpers.jumpToNextRequired();
if (nextRequired) {
  await wizard.goTo(nextRequired);
}

// Retry after error
if (helpers.stepStatus('payment') === 'error') {
  await wizard.goTo('payment');
}
```

### Configuration with Prerequisites & Ordering

```typescript
const wizard = createWizard({
  // ... base config

  // Explicit step order
  order: ['intro', 'details', 'payment', 'confirm'],

  // Progress weights
  weights: {
    intro: 1,
    details: 2,
    payment: 3,
    confirm: 1,
  },

  // Prerequisites (DAG)
  prerequisites: {
    payment: ['intro', 'details'],
    confirm: ['payment'],
  },

  // Custom completion check
  isStepComplete: ({ step, data }) => {
    if (step === 'payment') return !!data.payment?.cardLast4;
    return data[step] != null;
  },

  // Optional/required meta
  isOptional: (step, ctx) => step === 'details' && ctx.skipDetails,
  isRequired: (step, ctx) => step === 'payment' || step === 'confirm',

  // Status change hook
  onStatusChange: ({ step, prev, next }) => {
    console.log(`Step ${step}: ${prev} → ${next}`);
  },
});
```

### Mark Methods

Control step statuses programmatically:

```typescript
// Mark step with retryable error
wizard.markError('payment', new Error('Card declined'));

// Mark step as permanently failed
wizard.markTerminated('payment', new Error('Too many attempts'));

// Mark step as loading
wizard.markLoading('payment');

// Clear loading state
wizard.markIdle('payment');

// Mark step as skipped
wizard.markSkipped('details');
```

### Available Helper Methods

#### Identity & Ordering
- `allSteps()` - All declared steps
- `orderedSteps()` - Steps in order
- `stepCount()` - Total step count
- `stepIndex(step)` - Index of step
- `currentIndex()` - Index of current step

#### Status & Classification
- `stepStatus(step)` - Get step status
- `isOptional(step)` - Check if optional
- `isRequired(step)` - Check if required

#### Availability
- `availableSteps()` - Currently enterable steps
- `unavailableSteps()` - Blocked steps
- `refreshAvailability()` - Re-evaluate async guards

#### Progress & Completion
- `completedSteps()` - Finished steps
- `remainingSteps()` - Steps after current
- `firstIncompleteStep()` - First unfinished step
- `lastCompletedStep()` - Last finished step
- `remainingRequiredCount()` - Required steps left
- `isComplete()` - All required done?
- `progress()` - Progress metrics

#### Navigation
- `canGoNext()` - Can proceed?
- `canGoBack()` - Can go back?
- `canGoTo(step)` - Can jump to step?
- `findNextAvailable()` - Next valid step
- `findPrevAvailable()` - Previous valid step
- `jumpToNextRequired()` - Next required step

#### Graph & Prerequisites
- `isReachable(step)` - Can reach step?
- `prerequisitesFor(step)` - Step prerequisites
- `successorsOf(step)` - Next possible steps

#### Diagnostics
- `stepAttempts(step)` - Retry count
- `stepDuration(step)` - Time spent
- `percentCompletePerStep()` - Completion map

## API Reference

### Core (@wizard/core)

#### `createWizard(config)`

Creates a new wizard instance.

```typescript
const wizard = createWizard<Context, Steps, DataMap>({
  initialStep: Steps,
  initialContext: Context,
  steps: StepDefinitions,
  onTransition?: (event) => void,
  persistence?: PersistenceAdapter,
  keepHistory?: boolean,
  maxHistorySize?: number,
});
```

#### Wizard Instance Methods

- `next(args?)` - Go to next step with optional data
- `goTo(step, args?)` - Jump to specific step
- `back()` - Go to previous step (if history enabled)
- `reset()` - Reset to initial state
- `updateContext(updater)` - Update shared context
- `setStepData(step, data)` - Set data for a step
- `getContext()` - Get current context
- `getCurrent()` - Get current step info
- `subscribe(callback)` - Subscribe to state changes
- `emit(event)` - Emit custom event
- `snapshot()` - Get state snapshot
- `restore(snapshot)` - Restore from snapshot
- `markError(step, err)` - Mark step with retryable error
- `markTerminated(step, err?)` - Mark step as permanently failed
- `markLoading(step)` - Mark step as loading
- `markIdle(step)` - Clear loading state
- `markSkipped(step)` - Mark step as skipped
- `helpers` - Access helper methods (see Helpers & Status section)

### React (@wizard/react)

#### Components

- `<WizardProvider wizard={wizard}>` - Provides wizard to React tree

#### Hooks

- `useWizard()` - Get wizard instance
- `useWizardState(selector)` - Subscribe to state slice
- `useWizardStep()` - Get current step
- `useWizardSharedContext()` - Get shared context
- `useStepData(step)` - Get data for specific step
- `useCurrentStepData()` - Get current step data
- `useWizardLoading()` - Get loading state
- `useWizardTransitioning()` - Get transitioning state
- `useWizardHistory()` - Get navigation history
- `useWizardErrors()` - Get validation errors
- `useWizardActions()` - Get navigation actions

## Examples

See the `/examples` directory for complete examples:

- **React Router Wizard** - Full checkout flow with TanStack Router
- **Node Saga Wizard** - CLI wizard for order processing saga

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run examples
cd examples/react-router-wizard && pnpm dev
cd examples/node-saga-wizard && pnpm start
```

## Architecture

This monorepo uses:
- **pnpm** workspaces for package management
- **Nx** for build orchestration
- **tsup** for bundling
- **Vitest** for testing
- **TypeScript** strict mode throughout

## License

MIT

## Contributing

Contributions welcome! Please read our contributing guidelines before submitting PRs.
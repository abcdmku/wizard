# @wizard/core

Type-safe, headless wizard runtime for TypeScript.

`@wizard/core` is framework-agnostic and powers both browser and server use cases. For React bindings, use `@wizard/react`.

## Install

```bash
pnpm add @wizard/core
```

## Quick Start (Factory-First)

```ts
import { createWizardFactory } from '@wizard/core';

type Context = {
  userId?: string;
  total: number;
};

const factory = createWizardFactory<Context>();
const { defineSteps, step } = factory;

const steps = defineSteps({
  account: step({
    data: { email: '' },
    next: ['review'],
    validate: ({ data }) => {
      if (!data.email.includes('@')) throw new Error('Invalid email');
    },
  }),
  review: step({
    data: { agreed: false },
    next: [],
  }),
});

export const wizard = factory.createWizard(steps, {
  context: { total: 0 },
});

wizard.setStepData('account', { email: 'user@example.com' });
await wizard.next();
```

## Alternate Construction

You can also create directly with `createWizard(opts)`:

```ts
import { createWizard } from '@wizard/core';

const wizard = createWizard({
  context: {},
  steps: {
    start: { data: { ok: false }, next: ['done'] },
    done: { data: { confirmed: false }, next: [] },
  },
});
```

## Runtime API

Wizard instance properties:

- `store`
- `step`
- `context`
- `data`
- `meta`
- `errors`
- `history`
- `isLoading`
- `isTransitioning`
- `runtime`

Wizard instance methods:

- Navigation: `next`, `goTo`, `back`, `reset`
- Data/context: `setStepData`, `updateStepData`, `getStepData`, `updateContext`, `getContext`
- Meta: `setStepMeta`, `updateStepMeta`, `getStepMeta`
- Errors: `getStepError`, `getAllErrors`, `clearStepError`, `clearAllErrors`
- Step wrappers: `getStep`, `getCurrentStep`, `getCurrent`
- Status controls: `markError`, `markTerminated`, `markLoading`, `markIdle`, `markSkipped`

## Helper Highlights

Helpers are exposed on `wizard.helpers`.

Identity and ordering:

- `allStepNames`, `orderedStepNames`, `stepCount`, `stepIndex`, `currentIndex`
- `allSteps`, `orderedSteps`

Classification and progress:

- `stepStatus`, `isOptional`, `isRequired`
- `completedStepNames`, `remainingStepNames`
- `completedSteps`, `remainingSteps`
- `isComplete`, `remainingRequiredCount`, `progress`

Availability and navigation:

- `availableStepNames`, `unavailableStepNames`
- `availableSteps`, `unavailableSteps`
- `refreshAvailability`
- `canGoNext`, `canGoBack`, `canGoTo`
- `findNextAvailable`, `findPrevAvailable`
- `findNextAvailableName`, `findPrevAvailableName`
- `jumpToNextRequired`, `jumpToNextRequiredName`

Graph and diagnostics:

- `isReachable`, `prerequisitesFor`, `successorsOf`
- `firstIncompleteStep`, `lastCompletedStep`
- `firstIncompleteStepName`, `lastCompletedStepName`
- `stepAttempts`, `stepDuration`, `percentCompletePerStep`, `snapshot`

## Core Exports

Runtime exports:

- `createWizard`
- `createWizardFactory`
- `defineSteps`
- `step`
- `stepWithValidation`
- `resolve`
- `resolveMetaCore`

Primary types include:

- `Wizard`, `WizardState`, `WizardHelpers`, `WizardStep`
- `StepDefinition`, `StepArgs`, `StepEnterArgs`, `StepExitArgs`, `ValidateArgs`
- `StepMetaCore`, `StepStatus`
- `CreateWizardOptions`, `DataMapFromDefs`, `DataTypeOf`, `StepIds`, `ValOrFn`

## Compatibility Notes

These exports are retained for compatibility/migration paths:

- `WizardConfig`
- `WizardTransitionEvent`
- `WizardPersistence`
- `InferContext`, `InferSteps`, `InferDataMap`
- `EnhancedWizard`, `EnhancedDataMapFromDefs`
- `StepRuntime`

Removed APIs:

- `wizardWithContext`
- `dataStep`, `transitionStep`, `conditionalStep`

## Documentation

- Docs home: `packages/docs/pages/index.mdx`
- Getting started: `packages/docs/pages/getting-started.mdx`
- Core API page: `packages/docs/pages/api-docs/core.mdx`
- React API page: `packages/docs/pages/api-docs/react.mdx`
- Examples index: `packages/docs/pages/examples/index.mdx`

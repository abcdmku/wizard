# @wizard

Type-safe multi-step wizard primitives for TypeScript.

- `@wizard/core`: framework-agnostic wizard runtime
- `@wizard/react`: React hooks + provider + router sync helpers

## Install

```bash
pnpm add @wizard/core
pnpm add @wizard/react
```

## Core Quick Start

```ts
import { createWizardFactory } from '@wizard/core';

type CheckoutContext = {
  userId?: string;
  total: number;
};

const factory = createWizardFactory<CheckoutContext>();
const { defineSteps, step } = factory;

const steps = defineSteps({
  account: step({
    data: { email: '' },
    next: ['shipping'],
    validate: ({ data }) => {
      if (!data.email.includes('@')) throw new Error('Invalid email');
    },
    beforeExit: ({ data, updateContext }) => {
      updateContext((ctx) => {
        ctx.userId = data.email.toLowerCase();
      });
    },
  }),
  shipping: step({
    data: { address: '' },
    next: ['review'],
  }),
  review: step({
    data: { agreed: false },
    next: [],
  }),
});

export const wizard = factory.createWizard(steps, {
  context: { total: 0 },
});
```

## React Quick Start

```tsx
import { useWizard, useWizardStep } from '@wizard/react';
import { wizard } from './wizard';

function AccountStep() {
  const step = useWizardStep(wizard, 'account');
  return (
    <button
      onClick={() => {
        step.updateData({ email: 'user@example.com' });
        void step.next();
      }}
    >
      Continue
    </button>
  );
}

function WizardShell() {
  const { step } = useWizard(wizard);
  if (step === 'account') return <AccountStep />;
  return <div>Step: {step}</div>;
}
```

`WizardProvider` is optional. Hooks accept a wizard instance directly, and also support provider-based usage.

## Public Runtime API

Wizard instance:
- `step`, `context`, `data`, `meta`, `errors`, `history`
- `next`, `goTo`, `back`, `reset`
- `setStepData`, `updateStepData`, `getStepData`
- `setStepMeta`, `updateStepMeta`, `getStepMeta`
- `markError`, `markTerminated`, `markLoading`, `markIdle`, `markSkipped`
- `helpers` for navigation/progress/status queries

React exports:
- `WizardProvider`
- Hooks: `useWizard`, `useCurrentStep`, `useWizardStep`, `useWizardProgress`, `useWizardActions`, `useWizardHelpers`, `useStepError`, `useWizardSelector`
- Factories: `createReactWizardFactory`
- Router helpers: `useSyncWizardWithRouter`, `useTanStackWizardRouter`

## Examples

See `examples/`:
- `basic-form-wizard`
- `advanced-branching`
- `react-router-wizard`
- `node-saga-wizard`
- `persistence-local`
- `router-guard`
- `zod-validation`

## Development

```bash
pnpm install
pnpm build
pnpm test
```

# Migration Guide: Core/React vNext

## Removed APIs

1. Core wrappers removed
- `wizardWithContext` -> use `createWizardFactory`
- `dataStep` / `transitionStep` / `conditionalStep` -> use `step`

2. React router component helper removed
- `createWizardRouteComponent` -> use `useSyncWizardWithRouter` or `useTanStackWizardRouter`

3. React context wrappers removed
- `reactWizardWithContext` -> use `createReactWizardFactory`

## Factory Migration

Before:

```ts
const { defineSteps, step, createWizard } = wizardWithContext<MyContext>({...});
```

After:

```ts
const factory = createWizardFactory<MyContext>();
const { defineSteps, step } = factory;
const wizard = factory.createWizard(steps, { context: initialContext });
```

React:

```ts
const factory = createReactWizardFactory<MyContext>();
const { defineSteps, step } = factory;
const wizard = factory.createWizard(steps, { context: initialContext });
```

## Hook Migration

Canonical:

```tsx
useWizard(wizard)
useWizardStep(wizard, 'account')
```

Provider-based usage remains supported if desired.

## Type/Cast Cleanup

- remove `as ReturnType<typeof createWizard<typeof steps>>`
- remove step-data casts like `data as typeof initialData.stepName`
- rely on `step({ data: ... })` + `defineSteps(...)` inference

## Known Out-of-Scope

- DAG packages (`@wizard/dag-core`, `@wizard/dag-react`) were not part of this cleanup pass.

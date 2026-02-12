# Basic Form Wizard Example

This example now mirrors the home page flow exactly: `info -> plan -> pay -> done`.

## What This Example Demonstrates

- `createReactWizardFactory` with strongly typed step data
- Per-step validation with clear error messages
- Step components wired through wizard `component`
- `useWizardStep` for step-local actions/data updates
- `useWizard` helpers for navigation and progress

## Running the Example

```bash
pnpm --filter basic-form-wizard dev
pnpm --filter basic-form-wizard build
```

## Key Files

- `src/wizard/steps.ts`: flow definition, data shapes, validators
- `src/components/steps/InfoStep.tsx`: collects `name`
- `src/components/steps/PlanStep.tsx`: plan selection (`free|pro|team`)
- `src/components/steps/PaymentStep.tsx`: card formatting + submit
- `src/components/steps/DoneStep.tsx`: final summary + reset
- `src/components/StepIndicator.tsx`: visible-step progress UI

# Public API Decisions (vNext)

## Core
- `wizardWithContext`: **removed**
- `dataStep` / `transitionStep` / `conditionalStep`: **removed**
- Object-returning helper methods: **retained for compatibility** (name-returning helpers remain canonical)
- `getContext` and `getCurrent`: **retained**

## Types
- Extractor strategy: **single `DataTypeOf` + `DataMapFromDefs`**
- `defineSteps`: **identity model** with inference coming from `step()` branding and callback signatures
- Legacy aliases (`WizardConfig`, `Infer*`, `WizardPersistence`, etc.): **retained as compatibility exports**

## React
- Canonical hook style: **`useWizard(wizard)` / `useWizardStep(wizard, step)`**
- Provider overloads: **supported** (`wizard` arg optional when wrapped by `WizardProvider`)
- `WizardProvider`: **optional convenience**
- `component` contract: **component type-based step rendering**

## Router
- `createWizardRouteComponent`: **removed**
- Safe integration model:
  - `useSyncWizardWithRouter`
  - `useTanStackWizardRouter`
- Method-mutation router pattern: **forbidden**

# Evidence Pack (Phase 0)

## P0

1. Legacy core tests mismatched runtime API
- Files: `packages/core/src/wizard.test.ts`, `packages/core/src/helpers.test.ts`, `packages/core/src/tests/type-inference.test.ts`, `packages/core/src/tests/step-attributes.test.ts`
- Reproducer: `pnpm --filter @wizard/core test:run` (before rewrite)
- Resolution: replaced tests with current-API runtime + inference coverage

2. Removed API symbols still used across examples/docs
- Files: multiple under `examples/*` and `packages/docs/pages/**/*`
- Reproducer: unresolved exports (`wizardWithContext`, `reactWizardWithContext`, `createWizardRouteComponent`)
- Resolution: migrated to `createWizardFactory` / `createReactWizardFactory`; hook-based router sync

3. Missing docs example check script
- File: `packages/docs/scripts/check-examples-build.mjs` missing
- Reproducer: `pnpm --filter @wizard/docs check` failed on missing script
- Resolution: added script with explicit in-scope example matrix

## P1

4. Core data inference duplication and phantom bug risk
- Files: `packages/core/src/types.ts`, `packages/core/src/step-helpers.ts`, `packages/core/src/wizard-factory.ts`
- Resolution:
  - single extractor (`DataTypeOf`)
  - branded data helper (`WithDataBrand`)
  - unified `DataMapFromDefs`

5. Router integration mutated wizard methods
- File: prior `packages/react/src/tanstack-router.tsx`
- Resolution:
  - removed mutation pattern
  - added `useSyncWizardWithRouter` and `useTanStackWizardRouter`

6. React hook rerender and method identity pressure
- File: prior `packages/react/src/hooks.ts`
- Resolution:
  - selector simplification
  - bound method cache via `WeakMap`
  - optional provider overload path

## P2

7. Docs drift from exported surface
- Files: `README.md`, `packages/docs/pages/**/*`
- Resolution:
  - rewritten required pages + API references to current exports
  - legacy pages collapsed to truthful summaries where needed

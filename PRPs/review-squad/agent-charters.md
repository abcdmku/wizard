# Wizard Review Squad Charters

## 1) `core-type-arch` (Lead)
- Scope: `packages/core/src/types.ts`, `packages/core/src/wizard-factory.ts`, `packages/core/src/wizard.ts`
- Mandate:
  - unify step data extraction (`DataTypeOf` + `DataMapFromDefs`)
  - remove optional phantom `__data` pattern in favor of branded data
  - stabilize `createWizard`/factory inference

## 2) `core-runtime-shape`
- Scope: `packages/core/src/wizard.ts`, `packages/core/src/step-wrapper.ts`, legacy helper stack
- Mandate:
  - keep runtime behavior coherent with type surface
  - remove hidden internal option leaks from public API
  - document helper/step-wrapper behavior

## 3) `react-api-perf`
- Scope: `packages/react/src/hooks.ts`, `factory.tsx`, `types.ts`, `step-wrapper.ts`
- Mandate:
  - stable selectors / rerender hygiene
  - stable bound method references
  - explicit component contract and step rendering semantics

## 4) `router-integration`
- Scope: `packages/react/src/router.ts`, `packages/react/src/tanstack-router.tsx`, router example
- Mandate:
  - replace mutation-based router integration
  - define one safe URL sync model

## 5) `examples-integrity`
- Scope: all `examples/*` (core/react scope)
- Mandate:
  - one canonical factory pattern
  - remove API mismatch casts and removed-symbol usage
  - restore build matrix for in-scope examples

## 6) `docs-truth-audit`
- Scope: `README.md`, `packages/docs/pages/**/*`, docs scripts
- Mandate:
  - source-accurate docs
  - no fictional hooks/methods
  - docs checks include example build matrix

## 7) `dx-minimality-arbiter`
- Scope: cross-team decision authority
- Mandate:
  - tie-break feature richness vs syntax minimality
  - decide compatibility stance and canonical authoring style

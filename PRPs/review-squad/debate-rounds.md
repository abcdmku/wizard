# Formal Debate Rounds

## Round 1: Docs Utility Debate
- Parties: `docs-truth-audit` vs `dx-minimality-arbiter`
- Question: shortest happy-path vs exhaustive API?
- Winner: `dx-minimality-arbiter` with hybrid contract
- Rationale:
  - top-level pages optimize for shortest compile-safe path
  - API pages remain explicit and source-accurate
  - no page may document unexported symbols
- Contract adopted:
  - each guide uses minimal runnable examples
  - API reference pages carry the exhaustive symbol map

## Round 2: API Architecture Debate
- Parties: `core-type-arch` vs `core-runtime-shape`
- Question: canonical API vs compatibility wrappers?
- Winner: `core-type-arch` (canonical-first, selective compatibility)
- Rationale:
  - removed wrappers that created parallel ways to author steps (`wizardWithContext`, `dataStep` family)
  - retained a small compatibility type layer for migration (`WizardConfig`, etc.)
  - runtime keeps stable accessors (`getContext`, `getCurrent`) while canonical read path is property-based

## Round 3: DX Debate
- Parties: `react-api-perf` + `examples-integrity` vs `dx-minimality-arbiter`
- Question: factory and hook ergonomics with zero casts?
- Winner: joint `react-api-perf` + `examples-integrity`
- Rationale:
  - canonical pattern: factory-first + step helper + direct wizard hook usage
  - provider-based hook usage allowed, but explicit wizard arg is default in examples
  - removed `as ReturnType<...>` and step-data cast patterns from in-scope examples

## Round 4: Docs Navigation + API Parity Debate
- Parties: `docs-nav-ia` + `docs-truth-audit` vs `dx-minimality-arbiter`
- Question: stable global sidebar and API docs maintenance model?
- Winner: joint `docs-nav-ia` + `docs-truth-audit`
- Rationale:
  - section-scoped top-level `type: "page"` entries caused sidebar root switching and sparse home navigation
  - converting top-level docs groups to `type: "doc"` keeps one global docs tree and removes section-tab side effects
  - API pages use a hybrid model: curated guidance + auto-synced exhaustive export list from package entrypoints
- Contract adopted:
  - root docs sidebar is invariant across routes
  - API reference export maps are generated and checked in CI
  - compatibility exports are explicitly labeled to avoid canonical DX confusion

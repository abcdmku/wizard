# Decisions

Lightweight architecture decision records. One file per decision under `docs/design/adr/`; this index lists them newest-first. The full design lives in `docs/design/architecture-plan.md`.

| ADR | Title | Status |
|---|---|---|
| [ADR-001](docs/design/adr/ADR-001-type-strategy.md) | Step-id safety and flow-bound inference strategy (result of the M0 type spike; builder shape B, amended 2026-08-18) | accepted |
| [ADR-000](docs/design/adr/ADR-000-engine-and-no-modes.md) | Pure event-sourced machine + interpreter; step kinds + policies instead of `mode` | accepted |

## Rules that are not ADRs (see CONTRIBUTING.md)

- One canonical way to do each thing; no aliases, no arg-shape overloads.
- No field in a type without a runtime consumer and a test.
- Exactly one type extractor per concept.
- Every exported symbol has a test, a `.test-d.ts` assertion if generic, TSDoc `@public`, and a row in the generated export table.

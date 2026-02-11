# Prioritized Backlog (Post-Implementation)

## P1

1. Core helper semantics cleanup
- Async guard handling in `availableStepNames` is sync-biased.
- Weight-based progress is currently not represented in runtime helper math.

2. Cast debt reduction in core step-wrapper/runtime internals
- Remaining `as any` in migration and legacy helper modules should be audited and reduced.

3. Docs snippet typecheck enforcement
- Add a snippet extraction/typecheck pipeline in docs CI (currently matrix + typedoc checks).

## P2

4. Optional deprecation pass for object-returning helper methods
- Keep compatibility today; consider deprecating in a future major.

5. DAG package alignment
- Resolve `@wizard/dag-react` package entry/build chain for DAG demo integration.

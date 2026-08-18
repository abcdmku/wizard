# ADR-000 — Pure event-sourced machine + interpreter; step kinds + policies instead of `mode`

- Status: accepted (2026-08-17)
- Context: `docs/design/architecture-plan.md` §1.1, §1.2

## Context

OpenWizard v3 replaces two earlier attempts:

- **v1** (`git show abd8862`) — a mutable-store wizard runtime (`@tanstack/store`) with a 900-line closure, whole-state spreads on every write, `structuredClone` per context update, async guards with two sources of truth, an `emit` stub, and typed-but-inert step fields (`weight`, `prerequisites`, `maxRetries`). It was deeply type-safe in places but bloated and hard to reason about.
- **v3 draft docs** (`git show 06159e2`) — one engine with an explicit `mode: 'wizard' | 'dag' | 'saga' | 'hybrid'` and imperative pipelines. The review team's verdict: mode semantics were not type-constrained, navigation and scheduling affordances looked uniform while behaving differently, and the mode axis multiplied the test matrix.

The brief for v3 asks for sync **and** async workflows, "define and subscribe via TypeScript", deep understanding of complex systems, and client-safe projections of state.

## Decision

1. **The core is a pure machine plus a single-threaded interpreter.**
   `decide(def, state, msg) → DomainEvent[]`, `apply(def, state, event) → State`, `plan(def, state, event) → Effect[]` are pure (no I/O, timers or promises). One interpreter per wizard instance owns a FIFO queue, executes effects (hook calls, timers, child flows, persistence), and feeds results back as messages. Sync hook results are processed in the same call stack, so a transition made of sync hooks is committed before the public method returns; async only ever lives in effect execution.
2. **State is snapshot-authoritative; the event log is advisory.** Resume loads state directly; the bounded log (`observe()`, `log()`) exists for tracing, devtools and tests (`replay(log) == state` is a property test, not a hot path).
3. **No `mode`.** Behavior derives from step kinds (`view`, `task`, `wait`, `decision`, `flow`, `final`) plus a small policy set (`onFailure`, `retry`, `autoRun`, `concurrency`, `unmatchedEvents`). A pure wizard is "only views", a pure DAG is "only tasks with `dependsOn`", a saga is "tasks with `compensate` and `onFailure: 'compensate'`". Presets are documentation, not code paths.

## Consequences

- Every state change is a typed event with `causedBy`; the Mirror, devtools, replay and `explain()` are folds/queries over the same data.
- Sync and async are one code path; determinism is enforced by the queue (no re-entrant reduction; navigation commands during an in-flight transition are rejected with `nav-busy`).
- Contributors must learn the decide/apply/plan split; users never see it (the authoring DSL and `Wizard` façade sit on top).
- Removing `mode` removes a whole axis from the type system, docs and tests. It also means readiness must be one rule for wizards, DAGs and hybrids (see plan §1.2b).
- ~2–3 kB of extra bundle for the event/effect unions is accepted.

## Alternatives considered

- Mutable store + pipelines (v1/v3 draft): simplest to start, but replay/undo/mirror/devtools each need bespoke plumbing, and async guards keep drifting into two sources of truth.
- XState (or another general statechart engine) as the core: excellent semantics, but the wizard/DAG/saga vocabulary, boundaries and projections would still have to be built on top, and the type-inference story for step ids/inputs would be second-hand.
- Keeping `mode` as a preset object rather than a string: rejected as still implying uniform affordances; presets in docs achieve the same discoverability without a runtime axis.

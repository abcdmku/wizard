# ADR-000: Pure machine and interpreter, step properties instead of mode

- Status: accepted
- Date: 2026-08-17
- Current contracts: [architecture plan](../architecture-plan.md), [machine specification](../machine-spec.md)

## Context

OpenWizard replaced two earlier designs.

The v1 implementation at `abd8862` used a mutable store and a 900-line runtime closure. It spread whole state on writes, cloned context, and represented async guards in more than one place. Several typed fields, including weights and prerequisites, had no runtime behavior.

The draft at `06159e2` added a `mode` axis for wizard, DAG, saga, and hybrid behavior. Similar methods then behaved differently by mode, increasing the test matrix without explaining which step could use which feature.

The product needs synchronous and asynchronous work, typed composition, observable state, and projections that keep server data private.

## Decision

Use a pure machine and one interpreter per run:

```ts
decide(env, state, message) // Decision { events, state, at }
apply(env, state, event)   // event fold
plan(env, state, events)   // effect descriptions
```

The machine describes hook calls, timers, and child work without performing I/O. The interpreter owns the message queue and executes those effects. Synchronous hook results return to the queue before later hook calls start; asynchronous results use the same path.

State is snapshot-authoritative. Resume loads the snapshot directly. The bounded log supports tracing, devtools, and replay tests; it is not the resume source. Public reads show committed state, including while a durable commit barrier holds a staged batch.

Use three structural kinds, `step`, `view`, and `child`. A plain step runs a function, maps items, waits for an event, sleeps, or routes through `next`. Policies add retry, fallback, concurrency, or compensation. Data joins and waits on other steps use `needs`. These properties describe behavior without a mode switch.

## Consequences

- Typed events explain state changes. Inspection, replay, mirrors, devtools, and live explanations read the same facts.
- Sync and async hooks share a queue. Navigation cannot re-enter an in-flight transaction, and stale results do not change current work.
- Contributors need to understand decide, apply, and plan. Application code uses `defineWizard` and `Run`.
- Activation and gating need one explicit rule across navigation and background work. The machine specification defines it.
- Event and effect unions add code, but avoid separate state ownership for each integration.

## Alternatives considered

A mutable store with pipelines is easier to start, but each replay, mirror, and audit integration needs separate plumbing. It also repeats the async guard ownership problem.

A general statechart engine such as XState could execute transitions. OpenWizard would still need to build its data joins, compensation, boundaries, projections, and TypeScript inference around it.

Mode presets would preserve the ambiguous affordances. Documentation can show workflow patterns without introducing another runtime axis.

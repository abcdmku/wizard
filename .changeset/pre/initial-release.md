---
"@openwizard/core": minor
"@openwizard/opentelemetry": minor
"@openwizard/react": minor
"@openwizard/devtools": minor
---

Initial public release.

- `defineWizard` with pre-bound `step`, `view`, `flow`, and checked `steps` assembly. Define work, event waits, sleeps, routes, joins, mapped batches, and fallback paths with typed object configs.
- The wizard owns `create`, `createAsync`, `resume`, `resumeAsync`, `run`, `runSync`, and `provide`. Commands return `CommandResult`, `NavResult`, or `SendResult`. `WizardError` reports definition and boundary errors.
- Typed outcomes preserve mapped step errors and distinguish terminal results, recoverable halts, and external waits. `awaitResult` waits for a terminal result; `awaitOutcome` returns the next parked state. Snapshots preserve recovery state.
- Navigation, drafts, typed events with buffering and TTL, runnable-step retry/timeout/concurrency, sagas, nested flows, and reset.
- Persistence: `Store` port, `createMemoryStore`, auto-save / `save()`, snapshots JSON-checked before every write (`onPersistError`, `persist.failed`), resume that re-validates every boundary and applies the recovery matrix; single-owner in this release.
- Observability: `observe` / `log` events with `seq` / `path` / `causedBy`, `explain(step)`, and `inspect(wizard)` from `@openwizard/core/inspect`.
- `@openwizard/opentelemetry`: optional safe workflow, task-attempt, compensation, nested-flow,
  resume and external-event tracing with `@opentelemetry/api` as a peer dependency.
- Projections expose selected state and explicitly selected progress. `@openwizard/core/mirror` provides `createMirrorSource`, `createMirror`, `Transport`, frames, commands, acknowledgements, and wire parsers.
- `@openwizard/core/testing`: `createTestScheduler` (virtual time) and `createLocalTransport` (in-process loopback).
- `@openwizard/react`: `bindReact<typeof wizardOrProjection>()` provides owned run creation, subscriptions, navigation, child actions, and connection state over a `Run` or `Mirror`.
- Tested examples, reference systems, pattern guides, and package API references.

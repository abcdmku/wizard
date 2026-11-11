# @openwizard/core

## 0.1.0-next.0

### Minor Changes

- 0a488d0: Initial public release.
  
  - `defineFlow` + three pre-bound constructors (`step`, `view`, `flow`); plain-step behavior comes from `run`, `waitFor`, `route`, or `complete`; every id, payload, and hook is typed by the flow.
  - `createRun` / `createRunAsync` / `resumeRun` / `resumeRunAsync` over a pure event-sourced machine: sync-commit, batch atomicity, results as values (`CommandResult` / `NavResult` / `SendResult`, one `code` + `message` vocabulary), `WizardError` for programmer errors only.
  - Typed terminal outcomes (`RunResult<F>` / `FlowFailure<F>`): `result()`, `awaitResult()` and `subscribeResult()` preserve mapped task errors, distinguish cancellation from compensation failures, and reject pending waiters on reset/dispose; terminal metadata survives resume.
  - Navigation, drafts, typed events with buffering and TTL, runnable-step retry/timeout/concurrency, sagas, nested flows, and reset.
  - Persistence: `Store` port, `createMemoryStore`, auto-save / `save()`, snapshots JSON-checked before every write (`onPersistError`, `persist.failed`), resume that re-validates every boundary and applies the recovery matrix; single-owner in this release.
  - Observability: `observe` / `log` domain events with `seq` / `path` / `causedBy`, `explain(step)`, `inspect(flow)`.
  - `@openwizard/opentelemetry`: optional safe workflow, task-attempt, compensation, nested-flow,
    resume and external-event tracing with `@opentelemetry/api` as a peer dependency.
  - Projections and the wire: `defineProjection` (deny-by-default), `project`, `dispatch` + `parseCommand`; the Mirror protocol — `createMirrorSource`, `createMirror`, `Transport`, `Frame` / `WireCommand` / `WireAck`, `parseWireCommand` / `parseFrame`.
  - `@openwizard/core/testing`: `createTestScheduler` (virtual time) and `createLocalTransport` (in-process loopback).
  - `@openwizard/react`: `bindReact<typeof flowOrProjection>()` → `Provider` (with `serverSnapshot` for SSR / hydration), `useSnapshot`, `useCurrent`, `useStep`, `useSelector`, `useActions` over a `FlowRun` or a `Mirror`.
  - Eight tested examples and the API reference in `packages/core/README.md`.

### Patch Changes

- Add the durable storage and coordination contract with leases, fencing tokens,
  snapshot CAS, command and event dedupe, timer claims, a linearizable in-memory
  adapter, retention hooks, and the opt-in `createDurableRun` /
  `resumeDurableRun` host integration. The host is at-least-once and makes no
  exactly-once task guarantee; normal `createRun` and core `Store` remain
  single-owner APIs.
- Add the stable Effect 3.22 task adapter, typed durable failures, and native
  Effect helpers for starting and awaiting a FlowRun.

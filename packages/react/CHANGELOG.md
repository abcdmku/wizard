# @openwizard/react

## 0.1.0

### Minor Changes

- 0a488d0: Initial public release.
  
  - `defineFlow` + six pre-bound step constructors (`view`, `task`, `wait`, `decision`, `flow`, `final`); every id, payload and hook typed by the flow; boundaries (any Standard Schema or `boundary.parse/guard/assert/trusted`) as the only doors.
  - `createWizard` / `createWizardAsync` / `resumeWizard` / `resumeWizardAsync` over a pure event-sourced machine: sync-commit, batch atomicity, results as values (`CommandResult` / `NavResult` / `SendResult`, one `code` + `message` vocabulary), `WizardError` for programmer errors only.
  - Navigation (`next` / `back` / `go`), drafts (`setInput` / `resetInput` / `validate`), events (`send` with an event boundary, inbox buffering + TTL), tasks (`retry`, `timeout`, `run` / `runReady`, `concurrency`, `autoRun`), sagas (`onFailure: 'compensate'`, `compensate`, `cancel`), nested flows (`child`, typed `child` commands), `reset`.
  - Persistence: `Store` port, `createMemoryStore`, auto-save / `save()`, snapshots JSON-checked before every write (`onPersistError`, `persist.failed`), resume that re-validates every boundary and applies the recovery matrix; single-owner in this release.
  - Observability: `observe` / `log` domain events with `seq` / `path` / `causedBy`, `explain(step)`, `inspect(flow)`.
  - Projections and the wire: `defineProjection` (deny-by-default), `project`, `dispatch` + `parseCommand`; the Mirror protocol — `createMirrorSource`, `createMirror`, `Transport`, `Frame` / `WireCommand` / `WireAck`, `parseWireCommand` / `parseFrame`.
  - `@openwizard/core/testing`: `createTestScheduler` (virtual time) and `createLocalTransport` (in-process loopback).
  - `@openwizard/react`: `bindReact<typeof flowOrProjection>()` → `Provider` (with `serverSnapshot` for SSR / hydration), `useSnapshot`, `useCurrent`, `useStep`, `useSelector`, `useActions` over a `Wizard` or a `Mirror`.
  - Eight tested examples and the API reference in `packages/core/README.md`.

### Patch Changes

- Updated dependencies [0a488d0]
  - @openwizard/core@0.1.0

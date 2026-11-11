---
'@openwizard/core': minor
---

Hook progress reaches Mirrors.

- A hook's `progress(value)` now crosses the wire as a progress frame, and `mirror.observe(listener)`
  delivers the same `step.progress` event that `run.observe()` delivers locally, so one handler
  works for both. The event never enters frame state, snapshots or the log.
- Progress is deny-by-default and opt-in per step: `steps: { upload: { progress: true } }`. A
  child flow's steps opt in inside its nested `child` spec. The run-level `expose.progress: true`
  still only adds the `{ done, total, ratio }` summary to the state. Select projections opt in
  with `progress: { upload: true, sub: { child: { scan: true } } }`; omitting the map forwards
  no progress events. Mapped child events follow the same explicit nested exposure.
- A source over a child run (`createMirrorSource(run.child('sub'), childProjection)`) forwards
  that child's progress with paths relative to the child flow.
- `createMirror({ onListenerError })` and `createMirrorSource(..., { onListenerError })`: as on a run,
  a subscriber or observer that throws
  no longer stops the other listeners or the transport; the error goes to `onListenerError`
  (default: rethrown asynchronously).
- `Frame<S>` is now `SnapshotFrame<S> | ProgressFrame`, and `parseFrame` validates both kinds.
  `source.getFrame()` and `createMirror({ initial })` take a `SnapshotFrame<S>`. Code that reads
  `frame.state` from `subscribe` or a transport must check `frame.kind === 'snapshot'` first.
  `StepProgressEvent<F>` names the typed event.
- `expose.waitingFor: true` adds the same flat view, event and sleep waits as `run.waitingFor()`.
  Paths are relative to the projected run, including nested projections and mapped children.
- Mapped child projections expose child states or summaries in input order, with `null` slots
  for children not created yet. `mirror.child(step, index)` selects a mapped child, and its
  optimistic edits update the selected array item immediately. `retry` accepts mapped child steps.
- Optimistic input patches use the same issue filtering as local runs, clearing the patched
  fields while preserving unrelated fields and form issues.
- Mirror methods and wire commands use `startStep` and `startReady`. Removed names have no aliases.
- Wire `expectedSeq` reaches the run's atomic version guard, including when payload parsing is
  asynchronous or other sources dispatch commands on the same run.
- Mirror creation, transports and wire types live in `@openwizard/core/mirror`. Projections stay
  in the main entry; the wizard itself is passed to `defineProjection`.
- Module projections work with runs created or resumed from `wizard.provide(...)`. Provided
  variants share authored identity; separately authored same-name definitions remain rejected.
  `ProjectionDefinition<F>` gives adapters the shared state facts without creation dependencies.

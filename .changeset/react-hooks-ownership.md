---
'@openwizard/react': minor
---

- `useRun(create, deps?)` owns a `Run` or a `Mirror` inside a component: created once during
  render (server rendering and hydration have it), kept through StrictMode's simulated remount,
  recreated when `deps` change, disposed after the component unmounts. Renders React throws away
  never leak a source.
- Server rendering has one mechanism: seed the client source with the state the server rendered
  (`createMirror({ initial })`, `wizard.resume(snapshot)`) and create it with `useRun`. The `Provider`'s
  `serverSnapshot` prop is removed; hooks read the live source on the server and during hydration.
- `bindReact<typeof projection>()` returns a `MirrorBinding` with `useConnection()` (`connected`,
  `connect`), which re-renders when the transport drops or reconnects. Bindings over a wizard stay
  `ReactBinding` (a local run has no transport).
- `useStep(view)` binds helpers to views only: `next()` / `back()` resolve `NOT_ACTIVE` without
  sending anything when that view is not the current one; `issuesFor(field?)` filters the view's
  issues by field (path-less issues without an argument) and is typed only where the record
  carries `issues` (always over a run, over a projection when the step exposes `issues: true`).
- Step records over a `Run` carry the live `phase` (`validating` while an async `validate`
  hook runs, `running`, `retrying`, `waiting`, …), like projected records.
- `useActions()` is the source itself: `RunActions` over a run (commands plus `validate`,
  `explain`, `progress`), `Actions` over a Mirror (every command resolves a `MirrorResult`,
  `TRANSPORT_FAILED` instead of rejecting). `send` checks the payload against the event's schema.
- New exports: `useRun`, `MirrorBinding`, `BindingOf`, `Connection`, `ActionsOf`, `RunActions`,
  `CommandResultOf`, `FieldOf`.

---
'@openwizard/core': minor
---

Runs report outcomes instead of hanging.

- `wizard.run(input)` and `wizard.runSync(input)` return a `RunOutcome`: a terminal `RunResult`, a
  `RunHalted` (the failed step, its error and a `snapshot` to resume) or a `RunWaiting` (what the
  run waits on and a `snapshot`). A failed step never throws and never hangs. Retry backoff and
  sleeps keep `run()` going. `runSync` throws `SYNC_VIOLATION` naming the step when a hook returns
  a promise or a timer is needed. A `context` rejected by its boundary still throws
  `WizardError('BOUNDARY_REJECTED')`.
- `run.awaitOutcome()` waits for the next outcome that needs the outside world without disposing
  the run. `run.waitingFor()` and `run.explain(step).waitingFor` list the waits as one flat array of
  `{ kind: 'view' | 'event' | 'sleep', path, step, events?, deadline? }`; `path` locates child runs
  (`[]` is the run itself, typed by the wizard).
- A halted child run halts its parent; the parent's `RunHalted.failure.child` is the child's own
  halted outcome. Recover it through `run.child(step)`.
- `run.retry(step, { patch })` and the wire command `{ type: 'retry', step, patch }` merge a context
  patch before the step re-runs.
- New exports: `RunOutcome`, `RunHalted`, `RunWaiting`, `WaitingFor`.
- After `dispose()` every command resolves a `DISPOSED` value instead of throwing, an in-flight
  `validate()` resolves one `DISPOSED` issue, `attach()` / `subscribe()` / `observe()` /
  `subscribeResult()` are inert, `child(step)` returns the child that was disposed with the run,
  and `awaitOutcome()` rejects with `RunLifecycleError('RUN_DISPOSED')`.

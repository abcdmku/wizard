---
'@openwizard/core': patch
---

Hooks and state follow the commit boundary, in child runs too.

- A hook call that is cancelled or superseded before its turn never runs. For example, a `cancel()` or
  `skip()` issued from an `observe` listener, or a guard whose transition an earlier guard already
  rejected. The call is reported as aborted instead.
- A child run's hook waits until its parent has processed the messages queued before it. A parent
  `cancel()` issued from a listener or during a pending barrier stops the child before its hook runs.
- `getState()` and `getSnapshot()` show only committed state. While a `beforeEffects` barrier is
  pending, and after it rejects, they return the previous batch with the child snapshots committed
  with it. The barrier receives the staged snapshot, and hook `progress` events carry the committed
  `seq`.
- A synchronous failure while processing a command, such as an `ids` generator that throws,
  disposes the run like a failed barrier. Pending and later commands resolve `DISPOSED` instead of
  hanging, no child is restored into a run whose resume failed, and `child(step)` still returns the
  disposed child.
- A child run that stops on its own (a fatal error, or a direct `dispose()`) fails its child step
  instead of leaving the parent waiting.

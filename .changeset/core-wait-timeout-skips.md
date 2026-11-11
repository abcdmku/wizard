---
'@openwizard/core': minor
---

A wait that times out is now skipped. Before, `step({ waitFor, timeout: { after, next } })`
finished as `done` with output `undefined`, so every step that needed the wait had to check for
`undefined`, and such a step ran even though the run had taken the timeout path.

- The wait's status is `skipped` and its `skipReason` is `'timeout'`. The log records
  `step.skipped { reason: 'timeout', next }` where it used to record `step.done`.
- `timeout.next` starts as before. The wait's own `next` is not taken and its `exit` hook does
  not run. A handler that is still running when the deadline passes has its `signal` aborted.
- A step with a plain `needs` on the wait is skipped with reason `needs-skipped`.
  `{ optional: wait }` supplies `undefined`, and `{ any: [wait, other] }` waits for another
  producer.
- `OutputOf` of a wait no longer includes `undefined` because of a timeout.
- A timed-out wait is never the wizard's output. A sink that finished keeps the result.

To migrate, find each step that needs a wait with a `timeout`. If it must also run after a
timeout, change `needs: { reply }` to `needs: { reply: { optional: reply } }`. Otherwise remove
its `undefined` check.

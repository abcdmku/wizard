---
'@openwizard/core': patch
---

Deadlines are absolute and event delivery is atomic.

- On resume, a run fires its overdue wait timeouts and retries before it re-issues its interrupted
  idempotent runs. A run that an overdue deadline ended is not re-issued. The order holds per run:
  a parent resumes before its child runs are restored.
- When a `waitFor` handler or reducer halts the run during one `send` (it throws or returns
  `{ fail }`), the handlers of that event that have not started yet do not run: later step
  listeners and the flow-level `on` handler. A run that was already halted before the `send` still
  delivers it.

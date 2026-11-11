---
'@openwizard/core': minor
---

Add `Run.whenIdle()` so hosts can await the current FIFO drain, its synchronous follow-up
batches, and their `beforeEffects` barriers without waiting for future timers or long-running task
hooks.

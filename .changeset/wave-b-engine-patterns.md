---
'@openwizard/core': minor
---

Add durable sleep steps with deadlines preserved across restarts. Static fallbacks on runnable and child steps continue the flow after retry exhaustion while retaining the original failure on the skipped step.

Default flow output comes from the last completed sink. Fallback and timeout routes remain alternate edges, so they do not remove a step's happy-path output.

Wait handlers return payloads or explicit done values and reject next overrides. Passive event handlers can coexist with a wait. Remove synchronous wait reducers and completing-step hooks.

Cancelling or compensating during navigation aborts its transaction without recording a false guard verdict. Routing steps output undefined, validate declared targets, and exclude untaken branches only after the transition commits. Exit hooks no longer receive direction.

Mapped child flows park when their unfinished children wait for external input, while retry timers keep them running. Resuming restores automatic navigation after an already committed step completion without repeating its work.

Child commands can address one mapped item through its index path or a stable nonnumeric key. Invalidating a child step disposes its previous child runtimes.

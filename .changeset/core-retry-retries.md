---
'@openwizard/core': minor
---

Rename `retry.attempts` to `retry.retries`. The value always meant extra runs after the first
failure, so `attempts: 3` ran a step four times while `attempt` in hook arguments and events
counted runs from one. `retry: { retries: 3 }` now says what it does. The manifest field
`GraphRetry.attempts` is `GraphRetry.retries`, the Mermaid tag reads `3 retries`, and the
definition error is `retry.retries must be a non-negative integer`. Behaviour is unchanged.

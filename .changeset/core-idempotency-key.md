---
'@openwizard/core': minor
---

Rename the step option `idempotent` to `idempotencyKey`. It takes the same values: `true` for the
default key, or a function that returns your own. The option now has the name of the `run`
argument it feeds, so `idempotencyKey: ({ context }) => ...` and `run: ({ idempotencyKey }) => ...`
read as one thing. The manifest lists the hook as `idempotencyKey`.

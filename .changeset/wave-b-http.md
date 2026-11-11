---
'@openwizard/http': minor
---

Accept the wizard itself in `createHTTP`, type run handles as `Run`, and expose the served definition as `http.wizard`. Rename command capabilities and OpenAPI variants to `startStep` and `startReady`.

Retrying an optimistic Mirror command now replays its recorded response before sequence validation. Durable command receipts also replay across HTTP processes with separate response stores; changing the wire request under the same command id remains an idempotency conflict.

Validate optimistic sequence expectations at the interpreter's atomic dispatch point after asynchronous event parsing. Concurrent REST requests, background work, and cancellation now invalidate stale wire requests without blocking other mutations.

Describe optional retry context patches in OpenAPI, discriminate stream frames by `kind`, and release streamed request readers after completion or size-limit cancellation.

Fence idempotency completion and release by the successful claim's fresh `claimId`. `IdempotencyStore.complete(key, claimId, response)` and `release(key, claimId)` now return a boolean and must atomically compare the current pending owner. Expired or evicted requests cannot overwrite or remove newer replay records.

Wire acknowledgements read the current durable handle generation after dispatch, including when a terminal handle reopens while awaiting an external idempotency store.

HTTP reads and Mirror streams accept a module's base-wizard projection when its host supplies dependencies through `provide()`. Separately authored definitions with the same name and shape remain incompatible.

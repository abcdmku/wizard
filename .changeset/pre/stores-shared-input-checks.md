---
'@openwizard/drizzle': patch
'@openwizard/durable': patch
---

The memory store and the Drizzle adapters now run the same input checks, so malformed input fails
the same way on every store.

`@openwizard/drizzle`: `commit` checks the lease and `expected` before the record and the
completion markers. A `next`, `applyDedupe`, `completeDedupe` or `completeTimers` entry that is not
an object throws `DurableStoreError` with code `INVALID_ARGUMENT` instead of a `TypeError`. A `next`
without a `value` key throws `INVALID_ARGUMENT` before any storage call instead of
`NOT_SERIALIZABLE` after the lease check. The messages for a version that is not an object and for
a missing `next.version` now match the memory store.

`@openwizard/durable`: `sweep` on the memory store accepts the limits the Drizzle adapters accept.
A `limit` of `Infinity`, or an integer above `Number.MAX_SAFE_INTEGER`, throws `INVALID_ARGUMENT`.
Omit `limit` to sweep without one.

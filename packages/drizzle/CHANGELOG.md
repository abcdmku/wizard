# @openwizard/drizzle

## 0.1.0-next.1

### Minor Changes

- 13cfc63: Follow the `@openwizard/durable/store` protocol. The dedupe table drops its `kind` column and is
  keyed by `(run_key, dedupe_id)`: regenerate your migrations. Its `status` column also holds
  `applied` (a commit's `applyDedupe`), which a new lease owner never takes over. A commit completes
  every timer claim in `completeTimers`. Both adapters pass `durableStoreContract` from `@openwizard/durable/testing`.

### Patch Changes

- 13cfc63: Use one PostgreSQL statement for a fresh dedupe claim and one for a completion-only commit. Both statements lock the run row and enforce lease, fence, version, counter, and claim checks. Conflicts still use the existing locked transaction to return the exact replay or typed failure.
- 13cfc63: Use one atomic `UPDATE ... RETURNING` statement for snapshot-only PostgreSQL commits. The conditional update enforces lease expiry, fencing, compare-and-swap, and monotonic versions without the previous transaction and row-lock round trips.
- 704fe06: The memory store and the Drizzle adapters now run the same input checks, so malformed input fails
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
- Updated dependencies [13cfc63]
- Updated dependencies [704fe06]
- Updated dependencies [92251c6]
- Updated dependencies [13cfc63]
  - @openwizard/durable@0.1.0-next.1

## 0.1.0-next.0

### Minor Changes

- Add optional, provider-neutral Drizzle adapters for PostgreSQL and asynchronous
  SQLite. Applications keep ownership of connections, schema exports,
  migrations, credentials, and infrastructure.

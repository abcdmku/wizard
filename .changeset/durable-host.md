---
'@openwizard/durable': minor
---

Host durable runs by key and move the store protocol to its own entry.

- `createDurableHost(wizard, { store, ownerId?, renew?, deps?(key), onLeaseLost? })` returns
  `{ create(key, input), open(key), send(key, event, payload, { eventId }), dispatch(key, command, { commandId }), dispose() }`.
  It keeps live runs open, drops a run whose lease was lost and reopens it on the next call,
  releases a run's lease once it reaches a terminal result, and releases every lease on
  `dispose()`. Open failures (`LEASE_BUSY` with `retryAt`, `RUN_NOT_FOUND`, `LEASE_LOST`) are values.
- `createHostRegistry` remains for hosts that are not durable runs: same-key open sharing,
  generation-safe invalidation, expected-value eviction, and abortable disposal.
- The `DurableStore` protocol (`DurableStore`, `Version`, `Lease`, `CommitInput`, the dedupe and
  timer claim types, `DurableStoreError`) moves to `@openwizard/durable/store`. The new
  `@openwizard/durable/testing` entry exports `durableStoreContract`, the conformance suite every
  adapter should pass.
- Event dedupe uses core's `send(…, { eventId })`: the id is stored in the run snapshot and
  committed with the event's effects. `DurableEventOptions` is `{ eventId, correlationId? }` and a
  redelivered id returns `{ ok: true, duplicate: true, delivered: [], version }`, also after a
  takeover. Event `digest`/`expectedVersion`, `EVENT_PENDING`, and the dedupe claim `kind` are gone;
  command ids keep their digest check and `expectedVersion` gate.
- `DurableRunHost.send` and `DurableHost.send` type-check a typed payload exactly like
  `Run.send` (excess properties are rejected; an `unknown` body is still accepted).
  `host.claimTimer` is removed. `release()` and `dispose()` wait for commands and
  events already sent to the host.
- `renew: 'manual' | { everyMs }` replaces `renewEveryMs`; `everyMs` must be shorter than the
  lease TTL. The default TTL comes from the new required `DurableStore.leaseTtlMs`.
- `CommitInput.completeTimers` (an array) replaces `completeTimer`: the host completes every timer
  claim a committed batch consumed.
- A command can no longer run twice after a crash. The first snapshot committed after `dispatch`
  hands a command to the run carries `CommitInput.applyDedupe`, which marks its claim `applied` in
  the same write. A newer owner never takes an applied claim over: `claimDedupe` answers
  `{ status: 'applied' }` and the host returns `COMMAND_INTERRUPTED` instead of running the command
  again. `completeDedupe` completes a pending or applied claim; the conformance suite covers both.
- `DurableRunOptions` applies `redact` to every snapshot before the store sees it, and no longer
  accepts `debounceMs` or `onPersistError`. Host failures carry a `message`.

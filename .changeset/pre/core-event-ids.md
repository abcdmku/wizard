---
'@openwizard/core': minor
---

Deduplicate external events and type their payloads.

- `run.send(event, payload, { eventId })` remembers delivered ids in the snapshot. Redelivering a
  remembered id returns `{ ok: true, duplicate: true, delivered: [] }` and changes nothing, in any
  run status and after `reset()`; a later wait never consumes it. A payload rejected by the event
  boundary does not use up its id. `RunOptions.eventIds: { ttl, limit }` sets the window (default
  `{ ttl: '24h', limit: 1000 }`, oldest dropped first). The wire `send` command carries `eventId`.
- `run.send` and `mirror.send` check a typed payload against the event schema's input type (the new
  `PayloadInput<F, E>` extractor; `PayloadOf` stays the parsed type). An `unknown` body still
  compiles and is parsed by the boundary.

---
'@openwizard/core': minor
---

Reject non-JSON mapped and adapter errors before they enter snapshots, and retain validated adapter data on serialized errors. Keep error mapping separate for concurrent map items and retries.

Commit synchronous wait-handler context updates together with completion or failure. Cancel navigation hooks through their abort signals without cancelling unrelated running work.

Run callbacks can return or await a run adapter. The adapter receives the same arguments and abort signal, its output boundary is used unless the step declares one, and existing error mapping and retry policies still apply. Declare step output boundaries when persisted results need revival, such as Dates.

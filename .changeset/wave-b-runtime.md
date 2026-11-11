---
"@openwizard/core": minor
---

Rename live instances to `Run`, with `startStep` and `startReady` methods and commands. A wizard is its definition and carries provided dependencies into every creator. Projections defined for a base wizard work with its provided variants, while separately authored definitions remain rejected.

Add atomic optimistic dispatch through `expectedVersion`, and associate durable command results with the exact committing command. Interrupted navigation returns `CANCELLED`.

Restore the complete child tree before the first resume commit, including when a sibling dependency mapper fails. Mapped children can be addressed by item index or stable key, with readable indexed wait and event paths. Reject snapshots missing a live mapped child, revive per-item outputs, and migrate indexed child addresses and sleep/retry timers when steps are renamed.

Omitted optional dependency objects default to an empty bag at create, resume, and child boundaries. Explicit undefined and scalar dependency values keep their boundary semantics.

---
'@openwizard/durable': minor
---

Accept wizards directly and preserve dependencies supplied through `provide()` in durable creation and restoration. Host dependency factories require only dependencies that remain unprovided.

Persist command results with the exact command or completed navigation snapshot so a worker crash after the database commit still replays the original result. Unrelated local batches cannot mark an external command applied. An interrupted asynchronous navigation with no committed final result continues to return `COMMAND_INTERRUPTED`.

Give each durable dispatch a private command identity even when callers reuse the same command object locally. Recheck optimistic versions after asynchronous payload parsing and persist stale refusals for replay across workers.

Keep high-level opened handles usable across terminal lease release and awaited I/O. External handle commands and events reopen their key when needed, and explicit release waits for pending operations. Finish resumed drains before exposing a host so overdue deadlines precede late deliveries.

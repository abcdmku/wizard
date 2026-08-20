---
'@openwizard/core': patch
'@openwizard/durable': minor
---

Add the durable storage and coordination contract with leases, fencing tokens,
snapshot CAS, command and event dedupe, timer claims, a linearizable in-memory
adapter, retention hooks, and the opt-in `createDurableRun` /
`resumeDurableRun` host integration. The host is at-least-once and makes no
exactly-once task guarantee; normal `createRun` and core `Store` remain
single-owner APIs.

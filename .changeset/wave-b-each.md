---
'@openwizard/core': minor
---

Add mapped steps and child wizards with bounded concurrency and outputs in input order. Item snapshots, completed results, retry attempts, and idempotency keys survive restarts. Manual retry repeats failed items and preserves successful outputs. Each completed item reports transient `{ done, total }` progress to observers.

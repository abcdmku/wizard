---
'@openwizard/drizzle': minor
---

Follow the `@openwizard/durable/store` protocol. The dedupe table drops its `kind` column and is
keyed by `(run_key, dedupe_id)`: regenerate your migrations. Its `status` column also holds
`applied` (a commit's `applyDedupe`), which a new lease owner never takes over. A commit completes
every timer claim in `completeTimers`. Both adapters pass `durableStoreContract` from `@openwizard/durable/testing`.

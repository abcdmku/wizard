---
'@openwizard/drizzle': patch
---

Use one atomic `UPDATE ... RETURNING` statement for snapshot-only PostgreSQL commits. The conditional update enforces lease expiry, fencing, compare-and-swap, and monotonic versions without the previous transaction and row-lock round trips.

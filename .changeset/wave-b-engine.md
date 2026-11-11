---
'@openwizard/core': minor
---

Run mapped steps with bounded concurrency, ordered results, per-item retries, saved item results and transient completion progress. Child maps retain each item's own child runtime across resume.

Every step hook receives the outputs selected by its typed needs. Child wizards inherit their provided dependencies and validate the combined dependencies at creation.

Synchronous wait handlers commit their context updates with their completion. Restore child snapshots before committing the parent resume batch, identify the exact message behind each host barrier, and abort navigation guards when their transaction is cancelled.

Host barriers now stage child disposal with resets and invalidation, preventing a later resume from restoring removed children. Commands can check their expected version when they reach the interpreter queue; cancelled navigation returns `CANCELLED` without recording a false guard verdict.

Compensation uses a distinct idempotency key for each completion of a looping step. Retrying that compensation after resume keeps the same key.

Editing view input clears validation issues only for the patched fields and their nested values. Issues for unrelated fields and the whole form remain until validation runs again; replacing or resetting all input clears every issue.

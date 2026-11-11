---
'@openwizard/core': minor
---

Resume tolerates definition drift, and failed commands explain themselves.

- Steps added to a wizard since a snapshot was taken resume `idle`. A snapshot step the wizard no longer
  defines is rejected with a message that points at `renameSteps`.
- `migrate` results are stamped with the wizard's current version, so a migration only rewrites what
  changed: `migrate: (snapshot) => renameSteps(snapshot, { review: 'approve' })`.
  `renameSteps(snapshot: unknown, renames)` returns `unknown`.
- A snapshot whose values share an object (the same object in context and in a step output)
  resumes; only real cycles are rejected.
- `{ ok: false }` command, navigation and send results carry readable messages (for example
  `no step is waiting for 'hello' and unmatched events are not buffered`) next to their stable
  `code`.

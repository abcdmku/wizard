---
'@openwizard/drizzle': patch
---

Use one PostgreSQL statement for a fresh dedupe claim and one for a completion-only commit. Both statements lock the run row and enforce lease, fence, version, counter, and claim checks. Conflicts still use the existing locked transaction to return the exact replay or typed failure.

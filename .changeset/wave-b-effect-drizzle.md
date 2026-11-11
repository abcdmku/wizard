---
'@openwizard/effect': minor
---

Make `runEffect` a non-callable run adapter for `step({ run })`. Preserve the program's
output, typed failure data, and `retry.when` inference. Require `mapError` to return JSON
data, and update the example to return `steps(...)` from the wizard builder.

Allow the step to replace the adapter's output boundary and error mapping. The selected
step output and mapped error types reach `OutputOf`, `ErrorOf`, and `retry.when`.

For mapped items and joined data, return `runEffect` from the step's `run` callback. The
callback infers `item`, `index`, `needs`, and dependencies before creating the adapter;
its output and mapped failure data remain typed.

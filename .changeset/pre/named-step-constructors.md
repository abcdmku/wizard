---
"@openwizard/core": minor
---

Use object configs for `step`, `view`, and `child` constructors. Plain steps
run work, wait for events, sleep, or route through `next`. Typed `needs` joins
activate consumers and expose producer outputs to their hooks. Object references
work in every edge position and assembly rejects unknown references.

Wizard output is the output of a completed sink, or an explicit definition-level
selector. Fallback and timeout destinations are alternate paths when computing
sinks. Positional step functions, `route`, `complete`, and wait reducers are removed.

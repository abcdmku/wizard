---
'@openwizard/core': minor
---

Reduce the authoring model to three structural kinds: `step`, `view`, and `flow`.
Plain steps use `run`, `waitFor`, `sleep`, or `next` routing. Typed joins, mapped
work, and static fallback paths compose these behaviors. Remove the `task`,
`wait`, `decision`, and `final` constructors and kinds.

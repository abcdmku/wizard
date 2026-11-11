---
'@openwizard/react': minor
'@openwizard/devtools': minor
---

React bindings and devtools accept a `Run` created by the wizard itself. React actions use
`startStep` and `startReady`, preserve event IDs in child commands, and accept typed retry
context patches. Mirror types and constructors come from `@openwizard/core/mirror`.

`useChild(step, index)` selects one mapped child by its input index. Mapped steps require the
index, while ordinary children retain `useChild(step)`. Indexed bindings read exposed nullable
child arrays through a Mirror and preserve the selected item when sending scoped commands.

Devtools exports `RunSource` and `isRunSource` for its structural local-run input. The old
`FlowRunSource` and `isFlowRunSource` names are removed.

The graph labels named needs and fallback edges. Step cards and the inspector show map
concurrency, sleep durations, sink roles, and persisted item results.
Mapped child graphs and inspector selections use each child's input index and show exposed
per-item state from Mirrors.

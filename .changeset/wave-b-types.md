---
"@openwizard/core": minor
---

Infer object step configs and typed data joins through checked wizard assembly. Wizards carry resolved sink outputs and the dependencies still required after `provide()`. Preserve transformed event inputs for `send`, close wait handler results, type timeout outputs as possibly absent, and require item selectors and retry ids for mapped child steps.

Run adapters are records with typed execution metadata and JSON error channels. A run callback may return or await an adapter, preserving typed item, needs, service, output and retry inference. Assembly rejects returned adapters that require incompatible arguments. Generic step modules must use the same context, events and dependency types as the wizard that assembles them.

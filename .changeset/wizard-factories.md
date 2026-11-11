---
'@openwizard/core': minor
---

Define wizards with `defineWizard(options, ({ step, view, flow, steps }) => steps(map))`.
The returned wizard is the definition and owns `create`, `resume`, `run`, `runSync`,
their async variants, and immutable dependency provisioning through `provide`.
Bound dependencies travel into child runs and durable hosts. `RequiredDepsOf`
describes the dependencies a caller still needs to supply.

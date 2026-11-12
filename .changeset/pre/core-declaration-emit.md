---
'@openwizard/core': minor
---

A project compiled with `declaration: true` can export a wizard, a step module, a header object,
a projection, and values read from a run, with no type annotations. TypeScript reported TS4023 or
TS4058 for these because the inferred types used names the package did not export.

The main entry now exports `StepLinks`, `StepBinding`, `WizardOnArgs`, `WizardTypes` and
`WizardState`. `Issue`, `SerializedError`, `Progress`, `ChildSummary` and `AnyStep` are interfaces
under their own names. Each was an alias of an interface with no export, so the return type of
`run.validate()`, `run.progress()` or a rejected `run.next()` could not be named either. Their
shapes are the same.

`parseFrame` and `parseWireCommand` from `@openwizard/core/mirror` return issues typed as the
`Issue` of the main entry. The mirror entry declared its own copy, which no project could name.

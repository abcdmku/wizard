---
'@openwizard/effect': minor
---

`runEffect(program, { mapError? })` runs an Effect 4 program as a runnable step. The program gets
the step's typed `RunArgs` (inferred from the step, no annotation) and runs on the
`ManagedRuntime` carried in the wizard's deps (`EffectDeps<Services, LayerError>`), so a test swaps
the Layer without redefining the wizard. A program that needs a service the runtime does not
provide is a compile error. The step output is the program's success type; a typed failure (from
the program or the runtime's Layer) is recorded as failure kind `typed` with `mapError`'s value as
`error.data` (`ErrorOf`), a defect as `defect`, an interruption as `interrupted`. The step's abort
signal (timeout, cancel, dispose) interrupts the fiber.

The package now targets Effect 4 only (peer `effect@^4.0.0-beta.107`): the Effect 3 task adapter
and the `execute` / `awaitResult` helpers are removed.

# @openwizard/effect

## 0.1.0-next.1

### Minor Changes

- 13cfc63: `runEffect(program, { mapError? })` runs an Effect 4 program as a runnable step. The program gets
  the step's typed `RunArgs` (inferred from the step, no annotation) and runs on the
  `ManagedRuntime` carried in the wizard's deps (`EffectDeps<Services, LayerError>`), so a test swaps
  the Layer without redefining the wizard. A program that needs a service the runtime does not
  provide is a compile error. The step output is the program's success type; a typed failure (from
  the program or the runtime's Layer) is recorded as failure kind `typed` with `mapError`'s value as
  `error.data` (`ErrorOf`), a defect as `defect`, an interruption as `interrupted`. The step's abort
  signal (timeout, cancel, dispose) interrupts the fiber.
  
  The package now targets Effect 4 only (peer `effect@^4.0.0-beta.107`): the Effect 3 task adapter
  and the `execute` / `awaitResult` helpers are removed.
- 13cfc63: Make `runEffect` a non-callable run adapter for `step({ run })`. Preserve the program's
  output, typed failure data, and `retry.when` inference. Require `mapError` to return JSON
  data, and update the example to return `steps(...)` from the wizard builder.
  
  Allow the step to replace the adapter's output boundary and error mapping. The selected
  step output and mapped error types reach `OutputOf`, `ErrorOf`, and `retry.when`.
  
  For mapped items and joined data, return `runEffect` from the step's `run` callback. The
  callback infers `item`, `index`, `needs`, and dependencies before creating the adapter;
  its output and mapped failure data remain typed.

### Patch Changes

- Updated dependencies [13cfc63]
- Updated dependencies [aa69846]
- Updated dependencies [13cfc63]
- Updated dependencies [aa69846]
- Updated dependencies [13cfc63]
- Updated dependencies [3f99cf0]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [101aaee]
- Updated dependencies [13cfc63]
- Updated dependencies [4d63ba7]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [4d63ba7]
- Updated dependencies [0e93893]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [92251c6]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
- Updated dependencies [13cfc63]
  - @openwizard/core@0.1.0-next.1

## 0.1.0-next.0

### Minor Changes

- Add the original Effect 3.22 task adapter, typed durable failures, and native Effect helpers for
  starting and awaiting a FlowRun.

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies [0a488d0]
  - @openwizard/core@0.1.0-next.0

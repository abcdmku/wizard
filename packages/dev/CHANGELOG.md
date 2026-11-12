# @openwizard/dev

## 0.1.0-next.1

### Minor Changes

- beafcb3: Add `@openwizard/dev`, a local dev server and browser UI. `npx openwizard dev src/refund.ts` shows
  each wizard's graph, steps, schemas and generated page, starts runs and lists what each run waits
  for. You fill in forms, send events, answer service calls with a return value or an error, skip
  timers, and retry or skip failed steps. The wizards reload when a file they import changes.
  
  `defineDev` and `devWizard` give a wizard real services and a starting input. `startDevServer`
  starts the server from a script.
- 5b2d493: The dev UI shows the graph first, then what the run waits for, and gives a form, a payload or an input with a flat schema one field per property. `devWizard` takes `examples`, the values the form, event and service call editors open with. A run page has "Stop and resume", which disposes the run and resumes it from its snapshot.

### Patch Changes

- 28b48a1: `<WizardGraph follow>` keeps a wide graph readable: it draws the steps at a readable size, centred on the ones that are running, waiting or failed, and moves the view as the run does. The dev UI turns it on.
- 36cad95: Each form, event and failed step in the dev UI shows the call that does the same thing in code, such as `await run.send('refund.approved', { by: 'grace' })`.
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

---
'@openwizard/dev': minor
---

Add `@openwizard/dev`, a local dev server and browser UI. `npx openwizard dev src/refund.ts` shows
each wizard's graph, steps, schemas and generated page, starts runs and lists what each run waits
for. You fill in forms, send events, answer service calls with a return value or an error, skip
timers, and retry or skip failed steps. The wizards reload when a file they import changes.

`defineDev` and `devWizard` give a wizard real services and a starting input. `startDevServer`
starts the server from a script.

# 10 — Devtools (Vite + React)

Example 07's DAG pipeline — `ingest → (normalize ∥ enrich) → gate → approve → persist → done`,
with a retry, a `when`-guarded branch, an AND-join and (new here) an approval `wait` step —
running in a Vite page under the [`@openwizard/devtools`](../../packages/devtools/README.md)
panel:

- **Graph** — `inspect(pipeline)` laid out by ELK, every card coloured by its live status (the
  `retrying` pulse on `enrich`, the `waiting` dot on `approve`), the `dependsOn` edges into the
  gate, the dashed `?` port of the dynamic decision, the dotted `timeout` edge;
- **Events** — every domain event as it happens (`step.runStarted`, `step.retryScheduled`,
  `event.delivered`, …), filterable;
- **Inspector** — click a card: its record (attempt, `retryAt`, output), `explain()` reasons
  (`deps-unmet:enrich`, `retrying`, …) and its definition;
- **Timeline** — scrub the `seq` slider to see the state at any point of the run (the page hands
  the panel the `context` input, so the range starts at seq 0).

| File | Role |
|---|---|
| `src/pipeline.ts` | the flow (example 07 + the `approve` wait) and fake services with real delays |
| `src/wizard.ts` | `createWizard(pipeline, { context, deps })` — the object both the page and the panel read |
| `src/App.tsx` | Start / Send review.approved / Retry / Reset buttons, a status line, `<Devtools source={wizard} context={context} defaultOpen />` |
| `src/app.test.tsx` | headless run under jsdom: the buttons drive the pipeline, the panel's cards and event counter follow |

```sh
pnpm --filter example-10-devtools dev     # open the printed URL; ctrl+shift+d toggles the panel
pnpm --filter example-10-devtools check   # tsc + test + vite build (what CI runs)
```

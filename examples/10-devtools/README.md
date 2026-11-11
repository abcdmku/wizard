# Example 10: devtools

Inspect a live pipeline in the OpenWizard React devtools.

```sh
pnpm --filter example-10-devtools dev
pnpm --filter example-10-devtools check
```

`src/pipeline.ts` defines the wizard with `defineWizard` and object-configured steps. `src/wizard.ts` calls `pipeline.create(context, { deps })`. `src/App.tsx` drives the resulting `Run<typeof pipeline>` and renders the `Devtools` panel.

Ingest activates normalization and enrichment in parallel. The gate uses `dependsOn` to wait for both branches, then chooses one of its declared `targets`. The approval step waits for `review.approved`; its handler updates the context and returns `{ done: payload }`. A two-minute timeout sends the run to quarantine.

Open the panel to view the graph, event log, step details, and replay timeline.

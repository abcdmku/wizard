# Example 10: devtools

Inspect a live pipeline in the OpenWizard React devtools.

```sh
pnpm --filter example-10-devtools dev
pnpm --filter example-10-devtools check
```

`src/pipeline.ts` defines the flow. `src/wizard.ts` creates its run. `src/App.tsx` renders the run and the `Devtools` panel.

Open the panel to view the graph, event log, step details, and replay timeline.

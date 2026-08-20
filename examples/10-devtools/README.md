# 10: Devtools

This Vite app opens the parallel pipeline from example 07 in the OpenWizard devtools. The panel
shows live graph status, the committed event log, step details, and timeline replay. Read
[Run events](../../packages/docs/pages/concepts/observability.mdx) for the data behind the panel.

Source: [flow](./src/pipeline.ts), [run](./src/wizard.ts), [UI](./src/App.tsx),
[test](./src/app.test.tsx).

## Run

```sh
pnpm --filter example-10-devtools dev
pnpm --filter example-10-devtools check
```

Press `Ctrl+Shift+D` to toggle the panel.

Next: [11: Backend order workflow](../11-order-workflow).

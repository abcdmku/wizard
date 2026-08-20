# 09: Mermaid

This program turns `inspect(flow)` into a deterministic Mermaid diagram. It shows steps, edges,
timeouts, decisions, joins, and nested flows without running the flow. See
[Run events](../../packages/docs/pages/concepts/observability.mdx) for `inspect()`.

Source: [flow](./src/checkout.ts), [renderer](./src/main.ts),
[test](./src/mermaid.test.ts).

## Run

```sh
pnpm --filter example-09-mermaid start
pnpm --filter example-09-mermaid check
```

Next: [10: Devtools](../10-devtools).

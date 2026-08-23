# Example 09: Mermaid diagram

Inspect a flow and print a Mermaid flowchart.

```sh
pnpm --filter example-09-mermaid start
pnpm --filter example-09-mermaid check
```

`src/checkout.ts` defines the flow. `src/main.ts` passes it through `inspect()` and `toMermaid()`.

The output is text. Paste it into any Mermaid renderer or store it with generated documentation.

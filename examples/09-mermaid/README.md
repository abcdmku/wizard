# Example 09: Mermaid diagram

Inspect a wizard and print a Mermaid flowchart.

```sh
pnpm --filter example-09-mermaid start
pnpm --filter example-09-mermaid check
```

`src/checkout.ts` defines the wizard. `src/main.ts` passes the wizard itself through `inspect()` and `toMermaid()`. Declared `targets` let the diagram show both branches of a dynamic decision.

The output is text. Paste it into any Mermaid renderer or store it with generated documentation.

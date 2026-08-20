# 07: Parallel work

This ingest pipeline runs normalization and enrichment together, then joins them before saving.
It covers parallel `next` targets, `dependsOn`, concurrency limits, manual execution, `when`,
`skip()`, and `explain()`. Read
[Parallel work and joins](../../packages/docs/pages/concepts/dag.mdx) for the readiness rules.

Source: [flow](./src/pipeline.ts), [walkthrough](./src/main.ts),
[test](./src/pipeline.test.ts).

## Run

```sh
pnpm --filter example-07-dag-pipeline start
pnpm --filter example-07-dag-pipeline check
```

Next: [08: React and Mirror](../08-react-mirror).

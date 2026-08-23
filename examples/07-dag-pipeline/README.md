# Example 07: parallel pipeline

Two tasks run at the same time. A join waits for both before the pipeline continues.

```sh
pnpm --filter example-07-dag-pipeline start
pnpm --filter example-07-dag-pipeline check
```

Read `src/pipeline.ts` for multiple start steps, `dependsOn`, a condition, and a concurrency limit. `src/main.ts` prints the static graph and advances the virtual clock as each branch finishes.

The test also covers manual task control and a dependency on any one of several steps.

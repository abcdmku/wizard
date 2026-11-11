# Example 07: parallel pipeline

Two tasks run at the same time. A typed data join waits for both before routing the batch.

```sh
pnpm --filter example-07-dag-pipeline start
pnpm --filter example-07-dag-pipeline check
```

Read `src/pipeline.ts` for `needs`, optional results, declared branch targets and a concurrency limit. A need activates its consumer and gives every hook the producer's output. An optional need waits for the producer to settle and supplies `undefined` when it was skipped, so disabled enrichment does not skip the join.

`src/main.ts` prints the static graph and advances the virtual clock as each branch finishes. The tests also cover manual task control with `startReady()` and skipping a running enrichment task.

`src/batch.ts` maps over input items with `each`. Its test shows that output keeps input order and retry reuses completed items.

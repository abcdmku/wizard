# Example 02: retry failed work

A ledger call fails twice, waits between attempts, then succeeds.

```sh
pnpm --filter example-02-recoverable-failure start
pnpm --filter example-02-recoverable-failure check
```

Read `src/sync-invoice.ts` for the flow, then `src/main.ts` for the fake ledger and virtual clock. The test shows automatic retries, exhausted retries, and `run.retry('post')`.

The example passes the task's `idempotencyKey` to the ledger. A real ledger should reject duplicate requests with the same key.

# Example 02: retry failed work

A ledger call fails twice, waits between attempts, then succeeds.

```sh
pnpm --filter example-02-recoverable-failure start
pnpm --filter example-02-recoverable-failure check
```

Read `src/sync-invoice.ts` for the wizard, then `src/main.ts` for the fake ledger and virtual clock. `syncInvoiceFlow.create(context, { deps, scheduler })` creates the live run. The test shows automatic retries, exhausted retries, and `run.retry('post')`.

`retry.attempts: 3` permits three retries after the initial call. With `baseMs: 200` and exponential backoff, those retries wait 200, 400, and 800 ms. Exhaustion halts the run. A caller can repair the dependency and retry the failed step.

The example passes the task's `idempotencyKey` to the ledger. A real ledger should reject duplicate requests with the same key.

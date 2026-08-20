# 02: Recoverable failure

This flow posts an invoice to a flaky ledger. Its tests cover retries, stable idempotency keys,
typed error data, virtual time, and manual recovery after retries run out. It builds on
[01: Happy path](../01-happy-path) and [Policies](../../packages/docs/pages/concepts/policies.mdx).

Source: [flow](./src/sync-invoice.ts), [walkthrough](./src/main.ts),
[test](./src/sync-invoice.test.ts).

## Run

```sh
pnpm --filter example-02-recoverable-failure start
pnpm --filter example-02-recoverable-failure check
```

Next: [03: Compensation](../03-non-recoverable-compensation).

# 11: Backend order workflow

This order flow reserves inventory, charges with retry and idempotency, requests fulfilment, waits
for a typed shipment event, saves snapshots, and compensates a later failure. The
[order event guide](../../packages/docs/pages/guides/order-workflow.mdx) introduces the wait step
used here.

Source: [flow](./src/order-workflow.ts), [walkthrough](./src/main.ts),
[test](./src/order-workflow.test.ts).

## Run

```sh
pnpm --filter example-11-order-workflow start
pnpm --filter example-11-order-workflow check
```

Next: [12: Pulumi database binding](../12-pulumi-infrastructure).

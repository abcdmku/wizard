# Example 11: order workflow

A larger backend example with inventory, payment, fulfilment, a shipment event, saved state, retries, and compensation.

```sh
pnpm --filter example-11-order-workflow start
pnpm --filter example-11-order-workflow check
```

Read `src/order-workflow.ts` one step at a time. External services live in `deps`; saved business data lives in context. Each remote write receives an idempotency key. `mapError` records a JSON-safe failure, and `retry.when` retries payment outages while treating a decline as final.

Read `src/main.ts` after the flow. It supplies fake services, starts the run, saves it, and sends the shipment event.

Use examples 01 through 05 before this one.

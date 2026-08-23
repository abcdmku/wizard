# Example 05: receive events

A checkout waits for payment events from another system.

```sh
pnpm --filter example-05-external-events start
pnpm --filter example-05-external-events check
```

`src/checkout.ts` declares event schemas, a correlation rule, a buffer policy, and a wait step. `src/main.ts` sends four cases: invalid data, another order's event, an early event, and an event consumed by the wait.

The runtime checks every payload before a handler receives it.

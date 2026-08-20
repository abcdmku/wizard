# 05: Event inputs

This checkout waits for payment events sent with `run.send()`. It covers payload validation,
early-event buffering, expiry, wait timeouts, correlation, and flow-level handlers. Read
[Event inputs](../../packages/docs/pages/concepts/external-events.mdx) for the event model.

Source: [flow](./src/checkout.ts), [walkthrough](./src/main.ts),
[test](./src/checkout.test.ts).

## Run

```sh
pnpm --filter example-05-external-events start
pnpm --filter example-05-external-events check
```

Next: [06: Nested flow](../06-nested-flow).

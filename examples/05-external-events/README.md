# Example 05: receive events

A checkout waits for payment events from another system.

```sh
pnpm --filter example-05-external-events start
pnpm --filter example-05-external-events check
```

`src/checkout.ts` declares event schemas, a correlation rule, a buffer policy, and a wait step. `src/main.ts` creates a run with `checkoutFlow.create` and sends invalid data, another order's event, and an early event. Advancing the review view delivers the buffered event to the wait.

The runtime checks every payload before a handler receives it. Each wait handler returns `{ done: payload }`, which becomes the wait's output. The step's `next` function chooses `paid` or `declined` from its declared `targets`. The unchosen target becomes skipped. `timeout.next` handles the separate timeout path.

The tests also show wire-command validation, buffer expiry, late events, cancellation, and duplicate webhook deliveries with `eventId`.

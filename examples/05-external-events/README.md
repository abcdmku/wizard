# Example 05: receive events

A checkout waits for payment events from another system.

```sh
pnpm --filter example-05-external-events start
pnpm --filter example-05-external-events check
```

`src/checkout.ts` declares event schemas, a correlation rule, a buffer policy, and a wait step. `src/main.ts` creates a run with `checkout.create` and sends invalid data, another order's event, and an early event. Advancing the review view delivers the buffered event to the wait.

The runtime checks every payload before a handler receives it. Each wait handler returns `{ done }` with a `status` field, so the wait's output is one union: a captured payment or a failed one. A wait that times out is skipped and has no output. `timeout.next` starts `expired` instead, and `expired` returns the third outcome. The last step, `result`, needs whichever of the two finished, written `{ any: [awaitPayment, expired] }`. It turns the outcome into the run's output with one `switch` over `status`, and the compiler checks that the `switch` covers every outcome.

The tests also show wire-command validation, buffer expiry, late events, cancellation, and duplicate webhook deliveries with `eventId`.

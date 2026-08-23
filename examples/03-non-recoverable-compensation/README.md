# Example 03: compensate completed work

Flight, hotel, and car reservations succeed. Payment fails, so the completed reservations are undone in reverse order.

```sh
pnpm --filter example-03-non-recoverable-compensation start
pnpm --filter example-03-non-recoverable-compensation check
```

Read `src/book-trip.ts` first. Each task that can be undone has a `compensate` function. The flow uses `onFailure: 'compensate'`.

`src/main.ts` supplies fake services and prints the unwind order. The test also covers a compensation function that fails and is retried.

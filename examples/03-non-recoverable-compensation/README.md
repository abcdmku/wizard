# Example 03: compensate completed work

Flight, hotel, and car reservations succeed. Payment fails, so the completed reservations are undone in reverse order.

```sh
pnpm --filter example-03-non-recoverable-compensation start
pnpm --filter example-03-non-recoverable-compensation check
```

Read `src/book-trip.ts` first. Each step that can be undone has a `compensate` function. The wizard uses `onFailure: 'compensate'` and `bookTrip.create(context, { deps })` creates its run. Each compensation receives the completed step's typed output.

`src/main.ts` supplies fake services and prints the unwind order. The test also covers a compensation function that fails and is retried with `run.compensate({ from: 'reserveHotel' })`. The failed run stays terminal after compensation, while completed reservations remain marked `compensated`.

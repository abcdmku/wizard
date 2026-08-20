# 03: Compensation

This trip flow reserves a flight, hotel, and car before payment fails. It demonstrates
`onFailure: 'compensate'`, typed undo hooks, reverse-order cleanup, and retrying one failed undo.
Start with [02: Recoverable failure](../02-recoverable-failure), then read
[Policies](../../packages/docs/pages/concepts/policies.mdx).

Source: [flow](./src/book-trip.ts), [walkthrough](./src/main.ts),
[test](./src/book-trip.test.ts).

## Run

```sh
pnpm --filter example-03-non-recoverable-compensation start
pnpm --filter example-03-non-recoverable-compensation check
```

Next: [04: Resume from a snapshot](../04-resume-from-snapshot).

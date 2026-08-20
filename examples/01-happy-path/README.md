# 01: Happy path

This is the smallest complete flow. A view validates a profile, a task saves it, and a final step
returns the result. Start with [Defining flows](../../packages/docs/pages/concepts/defining-flows.mdx)
if `defineFlow`, `createRun`, `setInput`, or `next` is new to you.

Source: [flow](./src/onboarding.ts), [walkthrough](./src/main.ts),
[test](./src/onboarding.test.ts).

## Run

```sh
pnpm --filter example-01-happy-path start
pnpm --filter example-01-happy-path check
```

Next: [02: Recoverable failure](../02-recoverable-failure).

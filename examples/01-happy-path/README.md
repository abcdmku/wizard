# Example 01: hello flow

The smallest OpenWizard flow. It checks a name and returns a greeting.

```sh
pnpm --filter example-01-happy-path start
pnpm --filter example-01-happy-path check
```

Read the files in this order:

1. `src/hello-flow.ts` defines the one-step flow.
2. `src/main.ts` creates and starts a run.
3. `src/hello-flow.test.ts` checks the final output.

Expected output:

```text
Hello, Ada!
```

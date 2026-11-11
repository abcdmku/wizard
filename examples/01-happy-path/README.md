# Example 01: hello flow

The smallest OpenWizard wizard. It checks a name and returns a greeting.

```sh
pnpm --filter example-01-happy-path start
pnpm --filter example-01-happy-path check
```

Read the files in this order:

1. `src/hello-flow.ts` defines the wizard with `defineWizard` and `steps`.
2. `src/main.ts` calls `helloFlow.run({ name: 'Ada' })` and reads the outcome.
3. `src/hello-flow.test.ts` uses `helloFlow.create` when the caller needs a live run.

The single step has no successor, so its return value is the wizard's output. `run()` disposes the run after reaching an outcome. `create()` leaves disposal to the caller.

Expected output:

```text
Hello, Ada!
```

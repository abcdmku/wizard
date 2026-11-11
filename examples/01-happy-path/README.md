# Example 01: hello wizard

The smallest OpenWizard wizard. It checks a name and returns a greeting.

```sh
pnpm --filter example-01-happy-path start
pnpm --filter example-01-happy-path check
```

Read the files in this order:

1. `src/hello.ts` defines the wizard with `defineWizard` and `steps`.
2. `src/main.ts` calls `hello.run({ name: 'Ada' })` and reads the outcome.
3. `src/hello.test.ts` uses `hello.create` when the caller needs a live run.

The single step has no successor, so its return value is the wizard's output. `run()` disposes the run after reaching an outcome. `create()` leaves disposal to the caller.

Expected output:

```text
Hello, Ada!
```

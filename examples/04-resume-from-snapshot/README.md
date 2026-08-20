# 04: Resume from a snapshot

This approval flow saves while it waits, stops, and resumes as a new run instance. The example
covers stored snapshots, restored timers, interrupted tasks, and version migration. Core allows
one live owner per storage key. See
[Persistence and resume](../../packages/docs/pages/concepts/persistence.mdx) for that rule.

Source: [flow](./src/approval.ts), [walkthrough](./src/main.ts),
[test](./src/approval.test.ts).

## Run

```sh
pnpm --filter example-04-resume-from-snapshot start
pnpm --filter example-04-resume-from-snapshot check
```

Next: [05: Event inputs](../05-external-events).

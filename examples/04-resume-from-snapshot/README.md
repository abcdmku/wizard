# Example 04: save and resume

One process saves an approval run while it waits. A second process loads the snapshot and continues it.

```sh
pnpm --filter example-04-resume-from-snapshot start
pnpm --filter example-04-resume-from-snapshot check
```

Read `src/approval.ts` for the wizard. Then read `src/main.ts` in process order: `approval.create`, save, dispose, load, and `approval.resume`.

The scheduler uses virtual time, so the example can test a 48-hour timeout without waiting. Resume keeps the original absolute deadline. A snapshot already past that deadline takes the timeout path before an event can satisfy the wait.

The test also covers an interrupted task and a snapshot version migration. `src/migrate.ts` validates the fields the migration changes, preserves the other snapshot data, and adds the currency required by version 2. Store values stay `unknown` until resume validates them.

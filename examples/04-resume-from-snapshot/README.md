# Example 04: save and resume

One process saves an approval run while it waits. A second process loads the snapshot and continues it.

```sh
pnpm --filter example-04-resume-from-snapshot start
pnpm --filter example-04-resume-from-snapshot check
```

Read `src/approval.ts` for the flow. Then read `src/main.ts` in process order: create, save, dispose, load, and resume.

The scheduler uses virtual time, so the example can test a 48-hour timeout without waiting. The test also covers an interrupted task and a snapshot version migration.

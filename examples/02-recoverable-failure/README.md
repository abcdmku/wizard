# 02: recoverable failure (retry policy, `idempotent`, `mapError`)

You post an invoice to a flaky ledger. Sometimes a retry fixes it and sometimes a human has to
step in later, and the `post` task covers both without you writing any retry code.

## What it shows

| On the task | What it buys you |
|---|---|
| `retry: { attempts: 3, backoff: 'exponential' }` | waits of 200, 400, 800 ms, stored with the snapshot instead of living in a callback |
| `idempotent` | every attempt reuses one `args.idempotencyKey`, so a task a crash left running is re-run rather than failed |
| `mapError` | the raw thrown error becomes typed, JSON-safe data on `steps.post.error.data` |
| an injectable `scheduler` | `createTestScheduler()` drives the backoff in virtual time, so the tests never actually wait |

## Run it

```sh
pnpm --filter example-02-recoverable-failure start   # the flaky ledger demo, instant (virtual time)
pnpm --filter example-02-recoverable-failure check   # typecheck + vitest
```

## What the tests prove

The first test fails the ledger twice and walks the clock through both backoff windows before
attempt 3 succeeds. The second exhausts every attempt: the flow halts with `flow.failed` but
stays recoverable, and `retry('post')` finishes it once the fake ledger is repaired.

```ts
await settle() // attempt 1 fails, a retry is scheduled at now + 200 ms
expect(of('step.retryScheduled')[0]).toMatchObject({ attempt: 2, dueAt: 1_200, timerId: 'retry:post' })
expect(wizard.explain('post')).toMatchObject({ phase: 'retrying', reasons: ['retrying'] })
```

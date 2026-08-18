# 02 — recoverable failure (retry policy, driven by the test scheduler)

A task that posts to a flaky ledger with `retry: { attempts: 3, backoff: 'exponential' }`.
The retry policy is plain data (it persists with the snapshot and appears in `inspect()`); the
runtime schedules retries through its injectable `scheduler`, so a test drives time
deterministically with `createTestScheduler()`.

What it shows

- `retry: { attempts, backoff }` — a number is a fixed delay in ms; `'exponential'` waits `min(baseMs × factor^(attempt-1), maxBackoffMs)` (defaults 200 ms / 2 / 30 s).
- The retry deadline is state (`steps.post.retryAt`) and an event (`step.retryScheduled { dueAt, timerId }`); `explain('post')` reports `retrying` meanwhile.
- `createTestScheduler()` passed as `scheduler` (it doubles as the clock): `advance(ms)` fires due timers synchronously; only the async `run` promises still need a microtask tick.
- Exhausted retries → `step.failed { kind: 'run' }` → `flow.failed { code: 'STEP_FAILED' }`; the flow halts but stays recoverable: `next()` is rejected as a value (`FLOW_TERMINAL`), `retry('post')` re-runs the task and the flow completes.

Run

```sh
pnpm --filter example-02-recoverable-failure check
pnpm --filter example-02-recoverable-failure start
```

Excerpt (`src/sync-invoice.test.ts`)

```ts
await wizard.start()
await settle() // attempt 1 fails → retry scheduled at now + 200 ms
expect(of('step.retryScheduled')[0]).toMatchObject({ attempt: 2, dueAt: 1_200, timerId: 'retry:post' })
expect(wizard.explain('post')).toMatchObject({ phase: 'retrying', reasons: ['retrying'] })

sched.advance(200) // attempt 2 starts (and fails) exactly at the deadline
await settle()
expect(of('step.retryScheduled')[1]).toMatchObject({ attempt: 3, dueAt: 1_600 }) // +400 ms

sched.advance(400) // attempt 3 succeeds
await settle()
expect(wizard.getState().status).toBe('done')
```

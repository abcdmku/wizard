# 04: resume from a snapshot (persistence, crash, recovery, `migrate`)

An expense approval notifies a manager, then waits up to 48 hours for a decision. Process 1
saves every change to a store and dies, process 2 resumes the same instance on a fresh runtime,
and the deadline still fires at the right moment.

## What it shows

| Piece | What it does |
|---|---|
| `store` and `key` on `createWizard` | auto-saves a versioned, JSON-safe `Snapshot` after every committed change |
| `resumeWizard(flow, snapshot, options)` | re-validates the whole snapshot before accepting it |
| timers as state | the deadline is an absolute timestamp, so the resumed instance re-arms it for the time left |
| a task the crash interrupted | resumes as `step.failed` with `kind: 'interrupted'`, and the host decides whether to `retry()` |
| `migrate` | a snapshot of an older flow `version` is `SNAPSHOT_INCOMPATIBLE` until you convert it |

Persistence is single-owner, so never resume a snapshot on a second replica while the first
wizard is still alive, or both will run the side effects.

## Run it

```sh
pnpm --filter example-04-resume-from-snapshot start   # process 1 crashes, process 2 resumes
pnpm --filter example-04-resume-from-snapshot check   # typecheck + vitest
```

## What the tests prove

The crash-mid-wait test is the core of it. Two more cover the interrupted task (resume marks it
failed, `retry()` re-runs it) and the v1 to v2 migration, rejected without `migrate` and
completable with it.

```ts
first.dispose() // the process dies while the wait step is active

const resumed = resumeWizard(approval, await store.get(KEY), { deps, store, key: KEY, scheduler: sched2 })
expect(sched2.pending()).toBe(1) // the timer was re-armed for the remaining 45h

sched2.advance(45 * HOUR)
expect(resumed.getState().output).toBe('expired: nobody decided within 48h')
```

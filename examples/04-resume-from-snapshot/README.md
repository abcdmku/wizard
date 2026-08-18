# 04 — resume from a snapshot (persistence, crash, recovery matrix)

An expense-approval flow: an async `notify` task, then a `wait` step with a 48-hour timeout.
Process 1 auto-saves every change to a `Store` and dies; process 2 resumes the same instance
from the store on a fresh runtime. A second scenario crashes while the task is in flight.

What it shows

- `createWizard(flow, { store, key, autoSave: 'change' })` writes a versioned, JSON-safe `Snapshot` after every committed change (`save()` forces one). `createMemoryStore()` does a JSON round trip on every write, like a real database would.
- `resumeWizard(flow, snapshot, options)`: the envelope, flow identity (`name` + `version`), step set and every boundary are re-validated; `epoch` increments; the first logged event is `flow.resumed { fromSeq, interrupted }`.
- Timers are state: the wait deadline is absolute (`steps.awaitDecision.deadline`), so the resumed instance re-arms it for the remaining time — advancing the (virtual) clock fires `timer.fired` and routes to `timeout.next`.
- A snapshot is plain data — JSON-checked before every write (`onPersistError` / `persist.failed` name the offending path if a hook ever stores a `Date` or a class instance where no boundary revives it) — so a fresh process resumes it after the first one is gone and receives the decision via `send()` in time. Persistence is **single-owner** in v0.1: one live wizard per key, no compare-and-swap or lease in `Store`; never resume a snapshot on a second replica while the first wizard is still alive (both would run the side effects). Snapshot migration is v0.2.
- Recovery matrix for a task that was running when the snapshot was taken: on resume it becomes `step.failed { kind: 'interrupted' }` (the flow is `failed`, `explain()` says `failed:interrupted`); the host decides whether the side effect may run again and calls `retry()`.

Run

```sh
pnpm --filter example-04-resume-from-snapshot check
pnpm --filter example-04-resume-from-snapshot start
```

Excerpt (`src/approval.test.ts`)

```ts
first.dispose() // 💥 the process dies while the wait step is active

const resumed = resumeWizard(approval, await store.get(KEY), { deps, store, key: KEY, scheduler: sched2 })
expect(resumed.epoch).toBe(1)
expect(resumed.log()[0]).toMatchObject({ type: 'flow.resumed', fromSeq: saved.seq, interrupted: [] })
expect(sched2.pending()).toBe(1) // the timer was re-armed for the remaining 45h

sched2.advance(45 * HOUR)
expect(resumed.getState().steps.awaitDecision).toMatchObject({ status: 'done', output: { event: 'timeout' } })
expect(resumed.getState().output).toBe('expired: nobody decided within 48h')
```

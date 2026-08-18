# 03 — non-recoverable failure (compensation / saga)

Three reservations (flight, hotel, car), then a payment. The flow declares
`onFailure: 'compensate'`, so when the charge fails with no retries left every completed step
with a `compensate` hook is undone in reverse completion order — best effort, one at a time,
with the failures recorded rather than thrown.

What it shows

- `compensate: ({ output, deps }) => …` on a task: `output` is that task's own (typed) result, so the undo call has what it needs.
- The unwind order (`saga.stack` in completion order → compensated in reverse) and the events: `flow.compensating { plan }`, `step.compensationStarted` / `step.compensated` per entry, `flow.compensated { failures, outcome }`.
- A throwing `compensate` hook does not stop the unwind: it becomes `step.compensationFailed`, `saga.failures` and the step's `error.kind === 'compensate'`.
- `compensate({ from })` re-attempts exactly that failed entry once the supplier is back.
- A compensated flow is terminal: `retry()`, `next()`, further `compensate()` calls are rejected as `{ ok: false, code: 'FLOW_TERMINAL' }` — nothing throws.

Run

```sh
pnpm --filter example-03-non-recoverable-compensation check
pnpm --filter example-03-non-recoverable-compensation start
```

Excerpt (`src/book-trip.test.ts`)

```ts
await wizard.start() // all hooks are sync: reserved ×3, charge fails, unwound
expect(log).toEqual([
  'flights.reserve', 'hotels.reserve', 'cars.reserve', 'payments.charge',
  'cars.cancel CAR-T1', 'hotels.cancel H-T1', 'flights.cancel PNR-T1',
])
expect(of('flow.compensating')[0]).toMatchObject({ plan: ['reserveCar', 'reserveHotel', 'reserveFlight'] })
expect(wizard.getState().saga.compensated.map((e) => e.step)).toEqual(['reserveCar', 'reserveHotel', 'reserveFlight'])

// Second scenario: the hotel desk is offline during the unwind …
expect(wizard.getState().saga.failures).toEqual([{ step: 'reserveHotel', runId: 1 }])
// … and comes back: re-attempt only that entry.
expect(await wizard.compensate({ from: 'reserveHotel' })).toMatchObject({ ok: true })
expect(wizard.getState().saga.failures).toEqual([])
```

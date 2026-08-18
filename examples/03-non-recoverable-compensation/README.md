# 03: non-recoverable failure (compensation, saga)

The classic trip booking saga: reserve a flight, a hotel and a car, then charge the card. The
charge is declined, so the flow cancels all three reservations in reverse order, which the flow
declares in one line: `onFailure: 'compensate'`.

## What it shows

| Piece | What it does |
|---|---|
| `compensate` next to `run` | the undo hook gets that task's own typed `output`, so `deps.flights.cancel(output.pnr)` type-checks |
| `onFailure: 'compensate'` | a task that fails with no retries left unwinds every completed step in reverse completion order |
| `flow.compensating` to `flow.compensated` | events covering the whole unwind, including the plan |
| `saga.failures` | a throwing undo is recorded rather than fatal, and `compensate({ from })` re-attempts that one entry |
| after the unwind | the flow is terminal, so later calls answer `{ ok: false, code: 'FLOW_TERMINAL' }` instead of throwing, though `compensate({ from })` still works while `saga.failures` has entries |

## Run it

```sh
pnpm --filter example-03-non-recoverable-compensation start   # watch the unwind happen
pnpm --filter example-03-non-recoverable-compensation check   # typecheck + vitest
```

## What the tests prove

The fakes are synchronous and log every call, so the call log is the assertion. A second test
makes the hotel cancellation throw once, sees the unwind carry on past it, then clears the
recorded failure with `compensate({ from: 'reserveHotel' })`.

```ts
await wizard.start() // reserved x3, charge fails, unwound, all in one await
expect(log).toEqual([
  'flights.reserve', 'hotels.reserve', 'cars.reserve', 'payments.charge',
  'cars.cancel CAR-T1', 'hotels.cancel H-T1', 'flights.cancel PNR-T1',
])
```

# 05 — external events (webhooks through a boundary, inbox, TTL, timeout, correlation, flow-level `on`)

A checkout that waits for a payment provider's webhook. The flow declares its `events` as
schemas; `wizard.send(event, unknownBody)` is the only door for them.

What it shows

- `events: { 'payment.captured': z.object(…) }` — `send()` parses the untrusted body first: a bad one is `event.rejected` + `{ ok: false, reason: 'rejected', issues }`; a good one is `event.received` → `event.delivered { to }` to every active `wait` step listening for it. Handlers see the parsed payload and `update()` the typed context; a handler may return `{ next }` to override the step's static `next`.
- The early-webhook race: with `unmatchedEvents: { buffer: true, ttl: '10m' }` an event with no listener is buffered (`event.buffered { expiresAt }`, `state.inbox`) and delivered the moment a matching wait step enters — before its timeout is armed.
- TTL expiry (`event.expired`) and the wait `timeout: { after: '30m', next: 'expired' }` (an absolute `deadline`; `timer.fired` routes to `timeout.next`), both driven by `createTestScheduler()`.
- Correlation (v0.2): `defineFlow({ correlate: { 'payment.captured': (p) => p.orderId } })` + `createWizard(checkout, { correlationId: 'o-1' })` — a webhook whose extracted id differs is `event.dropped { reason: 'correlation' }` (never buffered, never delivered); payloads without an id are not filtered.
- Flow-level `on` (v0.2): `defineFlow({ on: { 'order.cancelled': ({ payload }) => ({ cancel: payload.reason }) } })` runs for the event whatever step is active (after step-level handlers) — here it cancels the flow from the review view, where no wait step listens.
- `dispatch({ type: 'send', … })` (the wire door, typed by the flow: an undeclared event name does not compile) runs the same boundary and answers a `CommandResult` (`BOUNDARY_REJECTED`); `send('typo', …)` from JS is a programmer error (`WizardError('UNKNOWN_EVENT')`).

Run

```sh
pnpm --filter example-05-external-events check
pnpm --filter example-05-external-events start
```

Excerpt (`src/checkout.test.ts`)

```ts
// nobody listens yet (the cursor is on the `review` view) → buffered
expect(await wizard.send('payment.captured', goodBody)).toMatchObject({ ok: true, delivered: [], buffered: true })
expect(wizard.getState().inbox).toHaveLength(1)

sched.advance(2 * MINUTE)
await wizard.next() // the wait step enters and drains the inbox first
expect(of('event.delivered')[0]).toMatchObject({ event: 'payment.captured', to: 'awaitPayment' })
expect(wizard.getState().output).toBe('paid (pay_1)')
```

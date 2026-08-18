# 05: external events (webhooks, inbox, TTL, timeout, correlation)

A checkout that waits for a payment provider's webhook. Bodies are untrusted, can arrive early,
can belong to a different order, or can never arrive at all, and `wizard.send(event, body)` is
the only door any of them come through.

## What it shows

| Piece | What it does |
|---|---|
| `events` on the flow | `send()` parses the body first, so a bad one is `event.rejected` plus `{ ok: false, reason: 'rejected', issues }` |
| `unmatchedEvents: { buffer: true, ttl: '10m' }` | an early event waits in `state.inbox` until a matching wait step enters, or the TTL expires it first |
| `timeout: { after: '30m', next: 'expired' }` | covers the webhook that never comes |
| `correlate` | a payload whose extracted id differs from the wizard's `correlationId` is dropped, never buffered |
| flow-level `on` | `order.cancelled` can land on any step, and its handler cancels the whole flow |
| `dispatch` with a `send` command | the wire version of `send()`, typed by the flow, answering a `CommandResult` |

## Run it

```sh
pnpm --filter example-05-external-events start   # bad body, foreign webhook, early webhook
pnpm --filter example-05-external-events check   # typecheck + vitest
```

## What the tests prove

Six tests, one per behaviour: the boundary rejection, the early buffer, the TTL expiry plus the
wait timeout, the handler override, the correlation drop, and the flow-level cancel. Buffering
is the heart of it:

```ts
// nobody is listening yet, the cursor is still on the `review` view, so it goes to the inbox
expect(await wizard.send('payment.captured', goodBody)).toMatchObject({ ok: true, delivered: [], buffered: true })

sched.advance(2 * MINUTE)
await wizard.next() // the wait step enters and drains the inbox first
expect(wizard.getState().output).toBe('paid (pay_1)')
```

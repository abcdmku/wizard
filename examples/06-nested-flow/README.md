# 06: nested flow (`s.flow(child)`, `wizard.child()`, `mirror.child()`)

An `order` flow charges the payment, then runs a `fulfilment` flow as one of its steps. The
child is a real wizard with its own queue, instance id and snapshot, and the parent step
completes when the child reaches a final, carrying the child's output.

## What it shows

| Piece | What it does |
|---|---|
| `s.flow(fulfilment, { context, exit, next })` | the `context` mapper builds the child's context from the parent's, parsed through the child's boundary |
| `wizard.child('fulfil')` | a typed `Wizard<typeof fulfilment>` you drive like any other wizard |
| child events | forwarded to the parent's `observe()` carrying `path: ['fulfil']` |
| `Snapshot.children.fulfil` | the child snapshot, so parent and child save and resume together |
| `dispatch` with a `child` command | routes a typed command down the path through the parent's queue |
| `mirror.child('fulfil')` | the same command sugar on the client, or `ow.useChild('fulfil')` in React |

## Run it

```sh
pnpm --filter example-06-nested-flow start   # parent pays, child ships, events with paths
pnpm --filter example-06-nested-flow check   # typecheck + vitest
```

## What the tests prove

The first test walks the whole life of the child. The second drives that same child purely
through wire commands (`parseCommand` plus `dispatch`), and the third from a client through a
`Mirror` with a projection into the child.

```ts
await wizard.start() // pay, then `fulfil` enters and creates the child with { orderId }
const child = wizard.child('fulfil')
await child.setInput('pick', { warehouse: 'west' })
await child.next() // pick, then ship (async), then shipped
await settle()
expect(wizard.getState().steps.fulfil).toMatchObject({ status: 'done', output: { tracking: 'TRK-WEST-o-1' } })
```

# 06 — nested flow (`s.flow(child, { context })`, `mirror.child()`)

An `order` flow pays, then embeds a `fulfilment` flow (view → task → final) as one of its steps.
The child is a wizard of its own — own queue, own instance id, own snapshot — and the parent
step completes with the child's output.

What it shows

- `s.flow(child, { context: (args) => childContextInput, deps?, exit, next })` — the mapper produces the INPUT side of the child's context boundary (parsed once, at child creation; defaults apply); `deps` maps the child's deps (parsed by the child's `deps` boundary), and without it the child receives the parent's `deps` object unchanged.
- `wizard.child('fulfil')` returns a typed `Wizard<typeof fulfilment>` once the step is active (`WizardError('NOT_ACTIVE')` before) — drive it with `setInput()` / `next()` like any wizard.
- Observability across levels: child events are forwarded to the parent's `observe()` / `log()` with `path: ['fulfil']`; the parent emits `child.started { childPath, context }` and keeps a `child` summary (`status`, `current`, `progress`) on the flow step.
- The child's `final` output is the parent step's typed `output` (used here in the flow step's `exit` hook to `update()` the parent context); `Snapshot.children.fulfil` nests the child snapshot, so parent and child persist and resume together.
- The wire door: `dispatch({ type: 'child', path: ['fulfil'], command })` routes commands to the child through the parent's queue (`child.command` events). `dispatch` is typed by the flow (`Command<typeof order>`: the path must name a flow step, the nested command is typed by the child); untrusted JSON is decoded with `parseCommand(order, body)`, which answers issues for a non-flow step.
- Client side (v0.2): a projection may expose the child's projected state (`steps: { fulfil: { child: { steps: { pick: { input: true } } } } }`, deny-by-default inside too), and `mirror.child('fulfil')` returns the child's command sugar typed by the CHILD flow — every call travels as `{ type: 'child', path: ['fulfil'], command }` over the loopback transport and is decoded against the child. (React: `ow.useChild('fulfil')` in `@openwizard/react`.)

Run

```sh
pnpm --filter example-06-nested-flow check
pnpm --filter example-06-nested-flow start
```

Excerpt (`src/order.test.ts`)

```ts
await wizard.start() // pay → fulfil enters → child created with { orderId }
const child = wizard.child('fulfil')
expect(child.getState().context).toEqual({ orderId: 'o-1', warehouse: 'east' }) // child boundary default
expect(events.filter((e) => e.path[0] === 'fulfil').map((e) => e.type).slice(0, 2)).toEqual(['flow.started', 'step.arrived'])

await child.setInput('pick', { warehouse: 'west' })
await child.next() // pick → ship (async) → shipped
await settle()
expect(wizard.getState().steps.fulfil).toMatchObject({ status: 'done', output: { tracking: 'TRK-WEST-o-1' } })
expect(wizard.getSnapshot().children.fulfil?.flow).toEqual({ name: 'fulfilment', version: 1 })
```

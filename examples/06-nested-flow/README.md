# Example 06: parent and child flows

An order flow runs a smaller fulfilment flow as one of its steps.

```sh
pnpm --filter example-06-nested-flow start
pnpm --filter example-06-nested-flow check
```

Read `src/order.ts` from the child definition to the parent definition. The parent maps its context into the child.

`src/main.ts` starts the parent, gets the live child with `run.child('fulfil')`, and drives the child's view. The test also drives the child through a Mirror.

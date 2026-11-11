# Example 06: parent and child wizards

An order wizard runs a smaller fulfilment wizard as one of its steps.

```sh
pnpm --filter example-06-nested-wizard start
pnpm --filter example-06-nested-wizard check
```

Read `src/order.ts` from the child definition to the parent definition. The parent maps its context into the child. The child's output becomes the output of the parent's `fulfil` step, and `receipt` reads it through `needs`.

`src/main.ts` starts the parent, gets the live child with `run.child('fulfil')`, and drives the child's view. The test also drives the child through a Mirror.

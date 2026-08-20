# 06: Nested flow

An order runs fulfilment as a child step. The example covers child context mapping, `run.child()`,
nested commands, child event paths, nested snapshots, and `mirror.child()`. It builds on
[05: Event inputs](../05-external-events) and [Nested flows](../../packages/docs/pages/concepts/nesting.mdx).

Source: [flows](./src/order.ts), [walkthrough](./src/main.ts), [test](./src/order.test.ts).

## Run

```sh
pnpm --filter example-06-nested-flow start
pnpm --filter example-06-nested-flow check
```

Next: [07: Parallel work](../07-dag-pipeline).

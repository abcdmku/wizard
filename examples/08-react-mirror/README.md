# 08: React and Mirror

This self-contained Vite app runs both sides of a server/client boundary in one browser page. The
host side owns the `FlowRun`. React receives only a projected `Mirror` over a serialized loopback
transport. The payment form keeps card numbers out of run state. Read
[Projections and the Mirror](../../packages/docs/pages/concepts/projections.mdx) before the
[React model](../../packages/docs/pages/concepts/react.mdx).

Source: [flow and projection](./src/flow.ts), [server](./src/server.ts),
[client](./src/client.ts), [UI](./src/App.tsx), [test](./src/app.test.tsx).

## Run

```sh
pnpm --filter example-08-react-mirror dev
pnpm --filter example-08-react-mirror check
```

Next: [09: Mermaid](../09-mermaid).

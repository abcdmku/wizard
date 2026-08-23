# Example 08: React mirror

A React checkout reads a filtered copy of a server run and sends commands back through a loopback transport.

```sh
pnpm --filter example-08-react-mirror dev
pnpm --filter example-08-react-mirror check
```

Read the files in this order:

1. `src/flow.ts` defines the checkout.
2. `src/server.ts` projects the run into client-safe state.
3. `src/client.ts` creates the Mirror and React binding.
4. `src/App.tsx` renders state and sends commands.

The browser never receives the full server context unless the projection exposes it.

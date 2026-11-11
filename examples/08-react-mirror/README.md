# Example 08: React mirror

A React checkout reads a filtered copy of a server run and sends commands back through a loopback transport.

```sh
pnpm --filter example-08-react-mirror dev
pnpm --filter example-08-react-mirror check
```

Read the files in this order:

1. `src/checkout.ts` defines the checkout with `defineWizard` and lists the fields its projection exposes.
2. `src/server.ts` calls `checkoutWizard.create(input, { deps })`, starts the run, and connects its projection to the loopback transport.
3. `src/client.ts` creates the Mirror from `@openwizard/core/mirror` and binds React to `typeof checkoutClient`.
4. `src/App.tsx` renders state and sends commands.

The shipping and payment views collect input. Object-configured `step({ run })` nodes reserve stock and charge the payment token. `charge` takes the token from the payment view through `needs`. A final `receipt` step joins the typed outputs of the earlier steps, and its result is the wizard's output. Context keeps `express` because the projection exposes it to the client.

Only the projection's listed context fields, view drafts, validation issues, task errors, and receipt cross the transport. The card number stays in the payment component until the provider SDK returns a token. This example runs its server in the page; move `server.ts` to a backend and replace the loopback transport for deployment.

# 08: React + Mirror (Vite)

A checkout rendered by React where the UI never touches the wizard: it only sees a `Mirror`,
reading frames and sending commands over a transport. The page hosts an in-page "server" to stay
self-contained, but the split between the two halves is the real production split.

## Who owns what

| File | Side | What is in it |
|---|---|---|
| `src/flow.ts` | server | the flow, its deps, and `checkoutClient`, the deny-by-default projection |
| `src/server.ts` | server | `createWizard` + `createMirrorSource` + `createLocalTransport`, delayed and serialized so the loopback behaves like a network |
| `src/client.ts` | client | `createMirror` and `bindReact`, with the projection imported type-only |
| `src/App.tsx` | client | the UI, built on `ow.Provider`, `ow.useStep`, `ow.useSelector`, `ow.useActions` |
| `src/main.tsx` | both | the composition root, the one file that knows both halves |

To go to production, drop the `startServer()` call in `main.tsx` and give `createClient()` a
transport that talks to your SSE or WebSocket endpoint. Nothing else changes.

## No card number reaches the wizard

The payment form hands the card straight to the provider SDK (`tokenizeCard`, faked in
`src/payments.ts`), so `setInput` only ever gets the token plus the last four digits, and the
step's `exit` copies just the token into the context.

## Run it

```sh
pnpm --filter example-08-react-mirror dev     # open the printed URL
pnpm --filter example-08-react-mirror test    # the headless UI test (jsdom)
pnpm --filter example-08-react-mirror check   # tsc + test + vite build (what CI runs)
```

## What the tests prove

`src/app.test.tsx` walks the full checkout through the DOM only (bad card rejected locally, good
card tokenised, `reserve` retried on the test scheduler, receipt on screen) and asserts the card
number appears nowhere in the snapshot. A second test cancels the order while the tasks run.

# 08 — React + Mirror (Vite)

A checkout (`shipping` → `payment` → `reserve` → `charge` → `receipt`) rendered by React **only through a `Mirror`**. The UI never touches the wizard, the flow module or the server: it reads frames and sends commands. The page also hosts an in-page "server" so the demo is self-contained.

| File | Role in production | Imports |
|---|---|---|
| `src/flow.ts` | server | `@openwizard/core`, `zod` — the flow, its deps interface and the deny-by-default projection `checkoutClient` (view drafts + issues, task errors, two context keys, the flow output — nothing else crosses) |
| `src/server.ts` | server | `createWizard` + `createMirrorSource(wizard, checkoutClient)` + `createLocalTransport` from `@openwizard/core/testing` (with `delayMs` and `serialize: true` so the loopback behaves like a network) |
| `src/client.ts` | client | `createMirror<typeof checkoutClient>` and `bindReact<typeof checkoutClient>()` — a **type-only** import of the projection |
| `src/payments.ts` | client | a stand-in for the payment provider's browser SDK: `tokenizeCard(pan)` → `{ token, last4 }` |
| `src/App.tsx` | client | the UI: `ow.Provider`, `ow.useStep('shipping')`, `ow.useSelector`, `ow.useCurrent`, `ow.useActions` — never touches the wizard object |
| `src/main.tsx` | composition root | starts the in-page server, hands its transport to the client |
| `src/app.test.tsx` | test | drives the whole thing headlessly (jsdom + Testing Library) through the DOM only |

**About the bundle.** `client.ts` and `App.tsx` import the projection type only, so *they* pull no flow code, schema or service into the client. The demo bundle as built here does contain them anyway, because `main.tsx` also imports `server.ts` to run the "server" in the page. To go to production, delete the `startServer()` call in `main.tsx` and give `createClient()` a transport that subscribes to your SSE/WS endpoint (frames = `source.subscribe`) and POSTs wire commands (`source.dispatch`, after authorization): `server.ts` and `flow.ts` then move to the server entry and disappear from the client bundle. Nothing in `client.ts` or `App.tsx` changes.

**No card numbers in state.** The payment form keeps the card number in local component state and hands it to the provider SDK (`tokenizeCard`, faked in `payments.ts`) — the way Stripe.js / Braintree work. Only the returned token (and `last4` for display) goes through `setInput`, so the wizard, its snapshots, the projection and every frame carry a `paymentToken`, never a PAN. The test asserts it (`JSON.stringify(wizard.getSnapshot())` contains the token and not the card).

What the demo shows:

- a form step with typed `setInput` (`ow.useStep('shipping').setInput({ name })` — `{ nope: 1 }` will not compile) and validation issues from the Zod boundary, `next` / `back`;
- running tasks with live `phase` / `attempt` (base facts) and the exposed sanitized `error` (`reserve` fails once and is retried: `retry: { attempts: 1, backoff: 400 }` — `attempts` counts retries after the first failure), and `cancel()` while running;
- a final screen from the flow `output`;
- a frame counter (`instanceId` / `epoch` / `seq`) — the UI is fed by frames, commands come back as acks.

```sh
pnpm --filter example-08-react-mirror dev     # open the printed URL
pnpm --filter example-08-react-mirror test    # the headless UI test (jsdom)
pnpm --filter example-08-react-mirror check   # tsc + test + vite build (what CI runs)
```
